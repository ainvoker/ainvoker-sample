import type { IncomingMessage, ServerResponse } from "node:http"
import type { ChatMessage, ToolCall } from "ainvoker"
import type { Plugin } from "vite"
import { isReasoning } from "../../../shared/call.ts"
import { createClient } from "../../../shared/client.ts"
import { hasApiKey, loadSampleEnv } from "../../../shared/env.ts"
import { errorSentence, usageSentence } from "../../../shared/format.ts"
import { findEntry, type CatalogEntry } from "../../../shared/models.ts"
import { isRecord, openSse, readJson, sendEvent, sendJson } from "../../shared/http.ts"
import { CHANGES_NOTES, NEEDS_APPROVAL, SERVER_ACTIONS, summarize, toolCatalog } from "./actions.ts"
import { runTurn, SYSTEM } from "./chat.ts"
import { EMBEDDING_SOURCE } from "./embeddings.ts"
import { drawImage, getImage } from "./images.ts"
import { createNote, deleteNote, getNote, listNotes, searchNotes, updateNote } from "./store.ts"

type Session = { messages: ChatMessage[]; busy: boolean }

const sessions = new Map<string, Session>()
/** Calls waiting on the page: Allow / Decline for approvals, tool content for browser actions. */
const waiting = new Map<
  string,
  { name: string; fallback: boolean | string; settle: (value: boolean | string) => void }
>()

const APPROVAL_TIMEOUT = 120_000
const BROWSER_TIMEOUT = 30_000

function sessionFor(id: unknown): { id: string; session: Session } {
  const key = typeof id === "string" && sessions.has(id) ? id : crypto.randomUUID()
  let session = sessions.get(key)
  if (!session) {
    session = { messages: [{ role: "system", content: SYSTEM }], busy: false }
    sessions.set(key, session)
  }
  return { id: key, session }
}

function entryFrom(body: Record<string, unknown>): CatalogEntry | undefined {
  return findEntry(String(body.provider ?? ""), String(body.model ?? ""))
}

function text(body: unknown, key: string): string {
  return isRecord(body) && typeof body[key] === "string" ? body[key].trim() : ""
}

function wait<T extends boolean | string>(call: ToolCall, ms: number, fallback: T, ids: Set<string>): Promise<T> {
  ids.add(call.id)
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(call.id)
      resolve(fallback)
    }, ms)
    waiting.set(call.id, {
      name: call.name,
      fallback,
      settle: (value) => {
        clearTimeout(timer)
        waiting.delete(call.id)
        resolve(value as T)
      },
    })
  })
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req)
  const content = text(body, "content")
  const entry = isRecord(body) ? entryFrom(body) : undefined
  if (!content || !entry || !isRecord(body)) {
    sendJson(res, 400, { message: "Send a message and choose a model." })
    return
  }
  const { id, session } = sessionFor(body.sessionId)
  if (session.busy) {
    sendJson(res, 409, { message: "Wait for the current reply to finish." })
    return
  }
  const reasoning = typeof body.reasoning === "string" && isReasoning(body.reasoning) ? body.reasoning : undefined

  session.busy = true
  const ids = new Set<string>()
  const emit = (event: Record<string, unknown>) => {
    if (!res.writableEnded) sendEvent(res, event)
  }
  const declined = JSON.stringify({ ok: false, error: { code: "DECLINED", message: "The page did not run this action" } })
  const settleAll = () => {
    for (const callId of ids) {
      const pending = waiting.get(callId)
      pending?.settle(pending.fallback)
    }
  }
  res.on("close", settleAll)

  openSse(res)
  emit({ type: "session", sessionId: id })
  try {
    const result = await runTurn([...session.messages, { role: "user", content }], entry, reasoning, {
      emit,
      confirm: (call, prompt) => {
        emit({ type: "approval", id: call.id, name: call.name, arguments: call.arguments, prompt })
        return wait(call, APPROVAL_TIMEOUT, false, ids)
      },
      runInBrowser: (call) => {
        emit({ type: "browser_action", id: call.id, name: call.name, arguments: call.arguments })
        return wait(call, BROWSER_TIMEOUT, declined, ids)
      },
    })
    session.messages = result.messages
    emit({ type: "done", status: result.status })
  } catch (error) {
    emit({ type: "error", message: errorSentence(error) })
  } finally {
    settleAll()
    session.busy = false
    res.end()
  }
}

function handleDecide(body: unknown, res: ServerResponse): void {
  const id = text(body, "id")
  const pending = waiting.get(id)
  if (!pending || !isRecord(body) || typeof body.allow !== "boolean") {
    sendJson(res, 404, { message: "That approval already finished." })
    return
  }
  pending.settle(body.allow)
  sendJson(res, 200, { ok: true })
}

function handleToolResult(body: unknown, res: ServerResponse): void {
  const id = text(body, "id")
  const content = isRecord(body) && typeof body.content === "string" ? body.content.slice(0, 20_000) : ""
  const pending = waiting.get(id)
  if (!pending || pending.name !== text(body, "name") || !content) {
    sendJson(res, 404, { message: "That action already finished." })
    return
  }
  pending.settle(content)
  sendJson(res, 200, { ok: true })
}

async function handleInvoke(body: unknown, res: ServerResponse): Promise<void> {
  const prompt = text(body, "prompt")
  const entry = isRecord(body) ? entryFrom(body) : undefined
  if (!prompt || !entry) {
    sendJson(res, 400, { message: "Send a question and choose a model." })
    return
  }
  // One-shot calls cannot show an approval, so only actions that never ask are offered.
  const tools = SERVER_ACTIONS.filter((action) => !NEEDS_APPROVAL.has(action.name) && action.name !== "generate_image")
  const ai = createClient()
  const fields = { prompt: `${SYSTEM}\n\n${prompt}`, tools, maxSteps: 4 }
  const result =
    entry.provider === "openai"
      ? await ai.action.invoke({ provider: entry.provider, model: entry.model, ...fields })
      : await ai.action.invoke({ provider: entry.provider, model: entry.model, ...fields, reasoning: "minimal" })
  sendJson(res, 200, {
    content: result.message.content,
    runs: (result.actionRuns ?? []).map((run) => ({
      name: run.call.name,
      ok: run.result.ok,
      detail: run.result.ok ? summarize(run.call.name, run.result.output) : run.result.error.message,
    })),
    notesChanged: (result.actionRuns ?? []).some((run) => run.result.ok && CHANGES_NOTES.has(run.call.name)),
    status: usageSentence(result.usage, result.requestIds?.at(-1) ?? result.id),
  })
}

async function handleNotes(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  const id = decodeURIComponent(url.slice("/api/notes/".length))
  if (url === "/api/notes") {
    if (req.method === "GET") {
      sendJson(res, 200, await listNotes())
      return
    }
    if (req.method === "POST") {
      const body = await readJson(req)
      const title = text(body, "title")
      const noteBody = text(body, "body")
      if (!title || !noteBody) {
        sendJson(res, 400, { message: "A note needs a title and some text." })
        return
      }
      sendJson(res, 201, await createNote({ title, body: noteBody }))
      return
    }
  } else if (req.method === "GET") {
    const note = await getNote(id)
    if (note) sendJson(res, 200, note)
    else sendJson(res, 404, { message: "No note has that id." })
    return
  } else if (req.method === "PUT") {
    const body = await readJson(req)
    const note = await updateNote(id, { title: text(body, "title"), body: text(body, "body") })
    if (note) sendJson(res, 200, note)
    else sendJson(res, 404, { message: "No note has that id." })
    return
  } else if (req.method === "DELETE") {
    if (await deleteNote(id)) sendJson(res, 200, { ok: true })
    else sendJson(res, 404, { message: "No note has that id." })
    return
  }
  sendJson(res, 405, { message: "Method not allowed." })
}

async function route(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  loadSampleEnv("app")
  const method = req.method ?? "GET"

  if (url === "/api/health" && method === "GET") {
    sendJson(res, 200, { ready: hasApiKey(), embeddings: EMBEDDING_SOURCE })
    return
  }
  if (url === "/api/tools" && method === "GET") {
    sendJson(res, 200, toolCatalog())
    return
  }
  if (url === "/api/notes" || url.startsWith("/api/notes/")) {
    await handleNotes(req, res, url)
    return
  }
  if (url.startsWith("/api/images/") && method === "GET") {
    const image = getImage(decodeURIComponent(url.slice("/api/images/".length)))
    if (!image) {
      sendJson(res, 404, { message: "That image is no longer in memory. Draw it again." })
      return
    }
    res.statusCode = 200
    res.setHeader("Content-Type", image.mimeType)
    res.setHeader("Cache-Control", "private, max-age=3600")
    res.end(image.bytes)
    return
  }
  if (method !== "POST") {
    sendJson(res, 404, { message: "Not found." })
    return
  }
  if (url === "/api/chat") {
    await handleChat(req, res)
    return
  }
  const body = await readJson(req)
  if (url === "/api/decide") handleDecide(body, res)
  else if (url === "/api/tool-result") handleToolResult(body, res)
  else if (url === "/api/invoke") await handleInvoke(body, res)
  else if (url === "/api/image") {
    const prompt = text(body, "prompt")
    if (!prompt) {
      sendJson(res, 400, { message: "Describe the image after /image." })
      return
    }
    const image = await drawImage(createClient(), prompt)
    sendJson(res, 200, { url: image.url, prompt: image.revisedPrompt, status: usageSentence(image.usage, image.id) })
  } else if (url === "/api/search") {
    const query = text(body, "query")
    sendJson(res, 200, { source: EMBEDDING_SOURCE, passages: query ? await searchNotes(query, 5) : [] })
  } else if (url === "/api/reset") {
    const old = sessions.get(text(body, "sessionId"))
    if (old?.busy) {
      sendJson(res, 409, { message: "Wait for the current reply to finish." })
      return
    }
    sessions.delete(text(body, "sessionId"))
    sendJson(res, 200, { sessionId: sessionFor(undefined).id })
  } else sendJson(res, 404, { message: "Not found." })
}

export function studioApi(): Plugin {
  return {
    name: "ainvoker-studio-api",
    configureServer(server) {
      loadSampleEnv("app")
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? ""
        if (!url.startsWith("/api/")) {
          next()
          return
        }
        route(req, res, url).catch((error: unknown) => {
          if (!res.headersSent) sendJson(res, 502, { message: errorSentence(error) })
          else res.end()
        })
      })
    },
  }
}
