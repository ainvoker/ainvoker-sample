import type { AInvoker, ChatMessage, TextReasoning, ToolCall } from "ainvoker"
import type { Action } from "ainvoker"
import type { CatalogEntry, ReasoningLevel } from "./models.ts"

export type ChatFields = {
  messages: ChatMessage[]
  tools?: Action[]
  maxSteps?: number
  approve?: (call: ToolCall, action: Action) => boolean | Promise<boolean>
  temperature?: number
  reasoning?: TextReasoning
}

function fieldsFor(entry: CatalogEntry, fields: ChatFields): ChatFields {
  if (entry.provider !== "gemini") {
    const { reasoning: _reasoning, ...rest } = fields
    return rest
  }
  return fields
}

export function chat(ai: AInvoker, entry: CatalogEntry, fields: ChatFields) {
  const body = fieldsFor(entry, fields)
  if (entry.provider === "openai") {
    return ai.text.chat({ provider: "openai", model: entry.model, ...body })
  }
  return ai.text.chat({ provider: "gemini", model: entry.model, ...body })
}

export function stream(ai: AInvoker, entry: CatalogEntry, fields: ChatFields) {
  const body = fieldsFor(entry, fields)
  if (entry.provider === "openai") {
    return ai.text.stream({ provider: "openai", model: entry.model, ...body })
  }
  return ai.text.stream({ provider: "gemini", model: entry.model, ...body })
}

export function isReasoning(value: string): value is ReasoningLevel {
  return value === "minimal" || value === "low" || value === "medium" || value === "high"
}
