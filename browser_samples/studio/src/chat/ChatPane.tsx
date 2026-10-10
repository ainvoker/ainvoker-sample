import { useEffect, useRef, useState } from "react"
import { CATALOG, findEntry, parseModelArg, REASONING, type CatalogEntry, type ReasoningLevel } from "../../../../shared/models.ts"
import { readSse } from "../../../shared/sse.ts"
import { BROWSER_ACTIONS, describeBrowserResult, setTheme } from "../actions/browser.ts"
import { api, isRecord, type Passage, type ToolInfo } from "../api.ts"
import { COMMANDS, parseCommand } from "./commands.ts"
import { Composer } from "./Composer.tsx"
import { Transcript, type Row, type ToolState } from "./Transcript.tsx"

const SUGGESTIONS = [
  "What's the lead time on oat milk, and when do I need to order?",
  "Switch to dark mode and open the espresso dial-in note.",
  "Is it hot enough in Portland today for a second cold brew batch?",
  "Add a note: the right grinder was serviced today.",
  "Draw a chalkboard sign announcing the spring menu.",
]

type ToolRow = Extract<Row, { kind: "tool" }>

const DOING: Record<string, string> = {
  search_notes: "Searching the handbook",
  list_notes: "Listing the notes",
  create_note: "Saving the note",
  update_note: "Updating the note",
  delete_note: "Deleting the note",
  get_weather: "Checking the weather",
  generate_image: "Drawing the image. This can take up to a minute",
  set_theme: "Changing the theme",
  open_note: "Opening the note",
  start_draft: "Writing the draft",
}

const THINKING = "Thinking"

let counter = 0
const nextKey = () => `row-${++counter}`

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function helpText(tools: ToolInfo[]): string {
  const where = { server: "server", universal: "server, universal", browser: "this tab" }
  return [
    "**Commands** run right away, without the model choosing a tool.",
    "",
    ...COMMANDS.map((command) => `- \`/${command.name}${command.args ? ` ${command.args}` : ""}\` ${command.description}`),
    "",
    "**Tools** the assistant can call when you ask in plain words. It decides which ones to use.",
    "",
    ...tools.map(
      (tool) => `- \`${tool.name}\` (${where[tool.runtime]}${tool.asks ? ", asks first" : ""}) ${tool.description}`,
    ),
  ].join("\n")
}

export function ChatPane({
  ready,
  onNotesChanged,
  onOpenNote,
}: {
  ready: boolean | null
  onNotesChanged: (focusId?: string) => void
  onOpenNote: (id: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [model, setModel] = useState<CatalogEntry>(CATALOG[0])
  const [reasoning, setReasoning] = useState<ReasoningLevel>("minimal")
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [tools, setTools] = useState<ToolInfo[]>([])
  /** What the assistant is doing right now, shown while nothing else is moving. */
  const [activity, setActivity] = useState<string | null>(null)

  useEffect(() => {
    api<ToolInfo[]>("/api/tools").then(setTools, () => setTools([]))
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [rows, activity])

  const push = (...added: Row[]) => setRows((current) => [...current, ...added])
  const notice = (text: string) => push({ kind: "notice", key: nextKey(), text })
  const fail = (text: string) => push({ kind: "error", key: nextKey(), text })

  function upsertTool(key: string, patch: Partial<ToolRow>, base?: Omit<ToolRow, "kind" | "key" | "state">) {
    setRows((current) => {
      const index = current.findIndex((row) => row.kind === "tool" && row.key === key)
      if (index < 0) {
        if (!base) return current
        return [...current, { kind: "tool", key, state: "running", ...base, ...patch }]
      }
      const next = [...current]
      next[index] = { ...(current[index] as ToolRow), ...patch }
      return next
    })
  }

  function appendDelta(text: string) {
    setRows((current) => {
      const last = current.at(-1)
      if (last?.kind === "assistant" && last.live) {
        return [...current.slice(0, -1), { ...last, text: last.text + text }]
      }
      return [...current, { kind: "assistant", key: nextKey(), text, live: true }]
    })
  }

  function settle() {
    setRows((current) => current.map((row) => (row.kind === "assistant" && row.live ? { ...row, live: false } : row)))
  }

  async function runBrowserAction(id: string, name: string, args: Record<string, unknown>) {
    upsertTool(id, { state: "running" }, { name, args, runtime: "browser" })
    const action = BROWSER_ACTIONS.find((item) => item.name === name)
    let content = JSON.stringify({ ok: false, error: { code: "UNKNOWN_TOOL", message: `This page has no ${name}` } })
    let state: ToolState = "failed"
    let detail = `This page has no ${name} action.`
    if (action) {
      const result = await action.run({ id, name, arguments: args })
      content = result.message.content
      state = result.ok ? "ok" : "failed"
      detail = result.ok ? describeBrowserResult(name, result.output) : result.error.message
    }
    upsertTool(id, { state, detail })
    try {
      await api("/api/tool-result", { body: { id, name, content } })
      setActivity(THINKING)
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not send the result back.")
    }
  }

  function onEvent(event: unknown) {
    if (!isRecord(event)) return
    const id = str(event.id)
    const args = isRecord(event.arguments) ? event.arguments : {}
    switch (event.type) {
      case "session":
        setSessionId(str(event.sessionId))
        break
      case "meta":
        setActivity(THINKING)
        break
      case "delta":
        if (event.content) setActivity(null)
        appendDelta(str(event.content))
        break
      case "tool_call":
        setActivity(DOING[str(event.name)] ?? `Running ${str(event.name)}`)
        upsertTool(id, {}, { name: str(event.name), args, runtime: str(event.runtime) || undefined })
        break
      case "approval":
        setActivity("Waiting for you to allow or decline")
        upsertTool(id, { state: "asking", prompt: str(event.prompt) }, { name: str(event.name), args, runtime: "server" })
        break
      case "action_result":
        setActivity(THINKING)
        upsertTool(
          id,
          { state: event.ok ? "ok" : event.declined ? "declined" : "failed", detail: str(event.detail), prompt: undefined },
          { name: str(event.name), args: {} },
        )
        break
      case "browser_action":
        setActivity(DOING[str(event.name)] ?? `Running ${str(event.name)} in this tab`)
        void runBrowserAction(id, str(event.name), args)
        break
      case "notes_changed":
        onNotesChanged(str(event.noteId) || undefined)
        break
      case "image":
        push({ kind: "image", key: nextKey(), url: str(event.url), prompt: str(event.prompt) || undefined })
        break
      case "done":
        setStatus(str(event.status))
        break
      case "error":
        fail(str(event.message))
        break
    }
  }

  async function decide(id: string, allow: boolean) {
    setActivity(allow ? "Running the action" : THINKING)
    upsertTool(id, { state: "running", prompt: undefined })
    try {
      await api("/api/decide", { body: { id, allow } })
    } catch (error) {
      upsertTool(id, { state: "failed", detail: error instanceof Error ? error.message : "Could not send that." })
    }
  }

  async function chat(content: string) {
    setBusy(true)
    setStatus("")
    setActivity(THINKING)
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, content, provider: model.provider, model: model.model, reasoning }),
      })
      await readSse(response, onEvent)
    } catch (error) {
      fail(error instanceof Error ? error.message : "This page could not reach its server.")
    } finally {
      settle()
      setActivity(null)
      setBusy(false)
    }
  }

  async function runCommand(name: string, rest: string) {
    switch (name) {
      case "help":
        notice(helpText(tools))
        return
      case "clear":
        setRows([])
        setStatus("")
        return
      case "new": {
        const body = await api<{ sessionId: string }>("/api/reset", { body: { sessionId } })
        setSessionId(body.sessionId)
        setRows([])
        setStatus("")
        return
      }
      case "theme": {
        const result = await setTheme.run({ id: nextKey(), name: "set_theme", arguments: { theme: rest } })
        if (result.ok) notice(describeBrowserResult("set_theme", result.output))
        else fail("Use /theme light, /theme dark, or /theme system.")
        return
      }
      case "model": {
        const parsed = parseModelArg(rest)
        const entry = parsed ? findEntry(parsed.provider, parsed.model) : undefined
        if (entry) {
          setModel(entry)
          notice(`Chatting with ${entry.label}.`)
        } else {
          notice(
            ["Choose one of these, for example `/model openai/gpt-4o-mini`:", "", ...CATALOG.map((item) => `- \`${item.provider}/${item.model}\``)].join("\n"),
          )
        }
        return
      }
      case "search": {
        if (!rest) return fail("Add what to look for, for example /search oat milk order day.")
        const body = await api<{ source: string; passages: Passage[] }>("/api/search", { body: { query: rest } })
        push({ kind: "passages", key: nextKey(), query: rest, source: body.source, passages: body.passages })
        return
      }
      case "ask": {
        if (!rest) return fail("Add a question, for example /ask who supplies our oat milk?")
        setActivity("Answering with ai.action.invoke")
        setBusy(true)
        try {
          const body = await api<{
            content: string
            runs: Array<{ name: string; ok: boolean; detail: string }>
            notesChanged: boolean
            status: string
          }>("/api/invoke", { body: { prompt: rest, provider: model.provider, model: model.model } })
          push(
            ...body.runs.map<Row>((run) => ({
              kind: "tool",
              key: nextKey(),
              name: run.name,
              args: {},
              runtime: "server",
              state: run.ok ? "ok" : "failed",
              detail: run.detail,
            })),
            { kind: "assistant", key: nextKey(), text: body.content, live: false, via: "Answered by ai.action.invoke. This reply is not part of the conversation." },
          )
          setStatus(body.status)
          if (body.notesChanged) onNotesChanged()
        } finally {
          setActivity(null)
          setBusy(false)
        }
        return
      }
      case "image": {
        if (!rest) return fail("Describe the picture, for example /image a chalkboard sign for pear soda.")
        const key = nextKey()
        upsertTool(key, {}, { name: "generate_image", args: { prompt: rest }, runtime: "server" })
        setActivity(DOING.generate_image)
        setBusy(true)
        try {
          const body = await api<{ url: string; prompt?: string; status: string }>("/api/image", { body: { prompt: rest } })
          upsertTool(key, { state: "ok", detail: "Image ready." })
          push({ kind: "image", key: nextKey(), url: body.url, prompt: body.prompt ?? rest })
          setStatus(body.status)
        } catch (error) {
          upsertTool(key, { state: "failed", detail: error instanceof Error ? error.message : "The image failed." })
        } finally {
          setActivity(null)
          setBusy(false)
        }
        return
      }
      default:
        fail(`There is no /${name} command. Type / to see the list.`)
    }
  }

  async function send(input: string) {
    const content = input.trim()
    if (!content || busy) return
    setDraft("")
    const command = parseCommand(content)
    if (command) {
      if (command.name !== "clear" && command.name !== "new") push({ kind: "user", key: nextKey(), text: content })
      try {
        await runCommand(command.name, command.rest)
      } catch (error) {
        fail(error instanceof Error ? error.message : "That command failed.")
      }
      return
    }
    if (ready === false) {
      fail("Add AINVOKER_API_KEY to ainvoker_sample/.env, then send again.")
      return
    }
    push({ kind: "user", key: nextKey(), text: content })
    await chat(content)
  }

  return (
    <section className="assistant" aria-label="Assistant">
      <header className="assistant-head">
        <h2>Assistant</h2>
        <label className="field">
          <span className="visually-hidden">Model</span>
          <select
            value={`${model.provider}/${model.model}`}
            onChange={(event) => {
              const next = CATALOG.find((item) => `${item.provider}/${item.model}` === event.target.value)
              if (next) setModel(next)
            }}
          >
            {CATALOG.map((item) => (
              <option key={`${item.provider}/${item.model}`} value={`${item.provider}/${item.model}`}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {model.provider === "gemini" ? (
          <label className="field">
            <span className="visually-hidden">Thinking</span>
            <select value={reasoning} onChange={(event) => setReasoning(event.target.value as ReasoningLevel)}>
              {REASONING.map((level) => (
                <option key={level} value={level}>
                  {level} thinking
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="quiet-button" disabled={busy} onClick={() => void send("/new")}>
          New chat
        </button>
      </header>
      {model.provider === "gemini" ? (
        <p className="hint">
          Gemini replies arrive in one piece here. Tool turns use ai.text.chat, because Gemini's stream drops the
          signature the next tool step needs.
        </p>
      ) : null}

      <div className="transcript" ref={scroller} aria-live="polite">
        {rows.length === 0 ? (
          <div className="welcome">
            <p>
              Ask about the handbook in plain words. The assistant searches the notes, edits them, changes this page,
              checks the weather, or draws a picture, and shows each step here. Type / for commands.
            </p>
            <ul>
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" disabled={busy} onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Transcript rows={rows} onDecide={(id, allow) => void decide(id, allow)} onOpenNote={onOpenNote} />
        )}
        {activity ? (
          <p className="activity" role="status">
            <span className="activity-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {activity}
          </p>
        ) : null}
      </div>

      <p className="status">{status}</p>
      <Composer value={draft} onChange={setDraft} onSend={(value) => void send(value)} busy={busy} tools={tools} />
    </section>
  )
}
