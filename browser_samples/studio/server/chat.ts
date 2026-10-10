import type {
  AInvoker,
  AssistantMessage,
  ChatMessage,
  ChatUsage,
  TextFinishReason,
  TextReasoning,
  ToolCall,
  ToolDefinition,
  Action,
} from "ainvoker"
import { createClient } from "../../../shared/client.ts"
import { seconds, usageSentence } from "../../../shared/format.ts"
import type { CatalogEntry } from "../../../shared/models.ts"
import { BROWSER_ACTIONS } from "../src/actions/browser.ts"
import { approvalPrompt, CHANGES_NOTES, NEEDS_APPROVAL, SERVER_ACTIONS, summarize } from "./actions.ts"

export const SYSTEM = [
  "You are the assistant inside the Northline cafe team handbook.",
  "For any question about how the cafe works, call search_notes first and answer from what it returns. Mention which note the answer came from.",
  "If the handbook does not cover it, say so plainly instead of guessing.",
  "Use list_notes or search_notes to find a note id before reading, updating, opening, or deleting a note.",
  "Use the page tools (set_theme, open_note, start_draft) when the person asks to change what they see.",
  "Only call generate_image when the person asks for a picture.",
  "If an action is declined or fails, tell the person and do not repeat the same call.",
  "Keep replies short. Use Markdown lists when listing steps.",
].join(" ")

/** Requests the SDK may make inside one round of actions. */
const MAX_STEPS = 6
/** Rounds that pause for the browser before the turn gives up. */
const MAX_ROUNDS = 4

export type Emit = (event: Record<string, unknown>) => void

type Fields = {
  messages: ChatMessage[]
  tools: Array<Action | ToolDefinition>
  maxSteps: number
  approve: (call: ToolCall) => Promise<boolean>
  reasoning?: TextReasoning
}

type Round = {
  messages: ChatMessage[]
  message: AssistantMessage
  finishReason: TextFinishReason
  usage: ChatUsage | null
  requestIds: string[]
}

const runtimeOf = new Map<string, string>(
  [...SERVER_ACTIONS, ...BROWSER_ACTIONS].map((action) => [action.name, action.runtime]),
)
const browserNames = new Set(BROWSER_ACTIONS.map((action) => action.name))
const serverNames = new Set(SERVER_ACTIONS.map((action) => action.name))

function withModel(entry: CatalogEntry, fields: Fields) {
  if (entry.provider === "openai") {
    const { reasoning: _reasoning, ...rest } = fields
    return { provider: entry.provider, model: entry.model, ...rest }
  }
  return { provider: entry.provider, model: entry.model, ...fields }
}

function addUsage(total: ChatUsage | null, next: ChatUsage | null): ChatUsage | null {
  if (!next) return total
  if (!total) return { ...next }
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  }
}

function emitToolCall(emit: Emit, call: ToolCall): void {
  emit({ type: "tool_call", id: call.id, name: call.name, arguments: call.arguments, runtime: runtimeOf.get(call.name) })
}

function emitActionResult(
  emit: Emit,
  run: { id: string; name: string; result: { ok: true; output: unknown } | { ok: false; error: { code: string; message: string } } },
): void {
  const { id, name, result } = run
  emit({
    type: "action_result",
    id,
    name,
    ok: result.ok,
    declined: !result.ok && result.error.code === "DECLINED",
    detail: result.ok ? summarize(name, result.output) : result.error.message,
  })
  if (!result.ok) return
  if (CHANGES_NOTES.has(name)) {
    const output = result.output as { id?: string }
    emit({ type: "notes_changed", noteId: name === "delete_note" ? undefined : output.id })
  }
  if (name === "generate_image") {
    const output = result.output as { url: string; revisedPrompt?: string }
    emit({ type: "image", url: output.url, prompt: output.revisedPrompt })
  }
}

async function streamRound(ai: AInvoker, entry: CatalogEntry, fields: Fields, emit: Emit, onFirstToken: () => void): Promise<Round> {
  const params = withModel(entry, fields)
  const events = params.provider === "openai" ? ai.text.stream(params) : ai.text.stream(params)
  for await (const event of events) {
    if (event.type === "meta") emit({ type: "meta", id: event.id, model: event.model })
    else if (event.type === "delta") {
      if (event.content) onFirstToken()
      emit({ type: "delta", content: event.content })
    } else if (event.type === "tool_call") emitToolCall(emit, event)
    else if (event.type === "action_result") emitActionResult(emit, event)
    else if (event.type === "done") {
      return {
        messages: event.messages ?? [...fields.messages, event.message],
        message: event.message,
        finishReason: event.finishReason ?? "stop",
        usage: event.usage,
        requestIds: event.requestIds ?? [],
      }
    }
  }
  throw new Error("The stream ended before the reply finished.")
}

/**
 * Gemini's stream splits a function call from its thought signature, and the
 * gateway then rejects the next step. Tool turns on Gemini use chat instead and
 * replay the result as the same events the stream would have sent.
 */
async function chatRound(ai: AInvoker, entry: CatalogEntry, fields: Fields, emit: Emit, onFirstToken: () => void): Promise<Round> {
  const params = withModel(entry, fields)
  const result = await (params.provider === "openai" ? ai.text.chat(params) : ai.text.chat(params))
  emit({ type: "meta", id: result.id, model: result.model })
  const ran = new Set<string>()
  for (const run of result.actionRuns ?? []) {
    ran.add(run.call.id)
    emitToolCall(emit, run.call)
    emitActionResult(emit, { id: run.call.id, name: run.call.name, result: run.result })
  }
  for (const call of result.message.toolCalls ?? []) {
    if (!ran.has(call.id) && !serverNames.has(call.name)) emitToolCall(emit, call)
  }
  if (result.message.content) {
    onFirstToken()
    emit({ type: "delta", content: result.message.content })
  }
  return {
    messages: result.messages ?? [...fields.messages, result.message],
    message: result.message,
    finishReason: result.finishReason ?? "stop",
    usage: result.usage,
    requestIds: result.requestIds ?? [result.id],
  }
}

export type TurnHooks = {
  emit: Emit
  /** Ask the person; resolves false when they decline or leave. */
  confirm: (call: ToolCall, prompt: string) => Promise<boolean>
  /** Run a browser action in the tab; resolves with the tool message content. */
  runInBrowser: (call: ToolCall) => Promise<string>
}

/**
 * One user turn. Server and universal actions run inside the SDK loop. Browser
 * actions go to the model as plain tool definitions, so the SDK stops with
 * `finishReason: "tool_calls"`; the tab runs them, and the next round continues
 * from the returned messages.
 */
export async function runTurn(
  history: ChatMessage[],
  entry: CatalogEntry,
  reasoning: TextReasoning | undefined,
  hooks: TurnHooks,
): Promise<{ messages: ChatMessage[]; status: string }> {
  const ai = createClient()
  const tools: Fields["tools"] = [...SERVER_ACTIONS, ...BROWSER_ACTIONS.map((action) => action.toTool())]
  const approve = async (call: ToolCall) =>
    !NEEDS_APPROVAL.has(call.name) || hooks.confirm(call, await approvalPrompt(call.name, call.arguments))
  const round = entry.provider === "gemini" ? chatRound : streamRound

  const started = Date.now()
  let firstTokenAt: number | undefined
  const onFirstToken = () => {
    firstTokenAt ??= Date.now()
  }
  let messages = history
  let usage: ChatUsage | null = null
  const requestIds: string[] = []
  let finishReason: TextFinishReason = "stop"

  for (let count = 1; count <= MAX_ROUNDS; count++) {
    const result = await round(ai, entry, { messages, tools, maxSteps: MAX_STEPS, approve, reasoning }, hooks.emit, onFirstToken)
    messages = result.messages
    usage = addUsage(usage, result.usage)
    requestIds.push(...result.requestIds)
    finishReason = result.finishReason
    if (finishReason !== "tool_calls") break

    for (const call of result.message.toolCalls ?? []) {
      if (serverNames.has(call.name)) continue
      const content = browserNames.has(call.name)
        ? await hooks.runInBrowser(call)
        : JSON.stringify({ ok: false, error: { code: "UNKNOWN_TOOL", message: `There is no tool named ${call.name}` } })
      messages = [...messages, { role: "tool", toolCallId: call.id, name: call.name, content }]
    }
  }

  const parts = [usageSentence(usage, requestIds.at(-1))]
  if (firstTokenAt !== undefined && entry.provider !== "gemini") {
    parts.push(`First word in ${seconds(firstTokenAt - started)}.`)
  }
  if (finishReason === "max_steps" || finishReason === "tool_calls") {
    parts.push("Stopped at the step limit. Send another message to continue.")
  }
  return { messages, status: parts.join(" ") }
}
