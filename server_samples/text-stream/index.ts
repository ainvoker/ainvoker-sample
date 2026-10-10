import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import type { AInvoker, ChatMessage } from "ainvoker"
import { stream } from "../../shared/call.ts"
import { createClient } from "../../shared/client.ts"
import { hasApiKey, loadSampleEnv } from "../../shared/env.ts"
import { errorSentence, seconds, usageSentence } from "../../shared/format.ts"
import {
  CATALOG,
  findEntry,
  parseModelArg,
  type CatalogEntry,
  type ReasoningLevel,
} from "../../shared/models.ts"
import { isReasoning } from "../../shared/call.ts"

loadSampleEnv("module")

const SYSTEM =
  "Write clearly and stop when the piece is done. Do not explain what you are about to write."

function printHelp(): void {
  console.log("Commands: /model, /reasoning, /clear, /help, /quit")
  console.log(`Models: ${CATALOG.map((entry) => `${entry.provider}/${entry.model}`).join(", ")}`)
  console.log("Thinking (Gemini): /reasoning minimal | low | medium | high | off")
}

async function main(): Promise<void> {
  if (!hasApiKey()) {
    console.error("Set AINVOKER_API_KEY in ainvoker_sample/.env")
    process.exit(1)
  }

  const ai: AInvoker = createClient()
  const rl = readline.createInterface({ input, output })
  let current: CatalogEntry = CATALOG[1]
  let reasoning: ReasoningLevel | undefined = "low"
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }]

  console.log("Text stream")
  console.log(`ai.text.stream · ${current.label} · thinking ${reasoning}`)
  printHelp()
  console.log()

  try {
    for (;;) {
      const line = (await rl.question("you> ")).trim()
      if (!line) continue
      if (line === "/quit") break
      if (line === "/help") {
        printHelp()
        continue
      }
      if (line === "/clear") {
        messages.splice(1)
        console.log("Conversation cleared.")
        continue
      }
      if (line.startsWith("/model")) {
        const parsed = parseModelArg(line.slice("/model".length))
        const next = parsed ? findEntry(parsed.provider, parsed.model) : undefined
        if (!next) {
          console.log("Usage: /model gemini gemini-3.5-flash-lite")
          continue
        }
        current = next
        console.log(`Model is ${current.label}.`)
        continue
      }
      if (line.startsWith("/reasoning")) {
        const value = line.slice("/reasoning".length).trim()
        if (value === "off") {
          reasoning = undefined
          console.log("Thinking is off. The provider default applies.")
          continue
        }
        if (!isReasoning(value)) {
          console.log("Usage: /reasoning low")
          continue
        }
        reasoning = value
        console.log(
          current.provider === "gemini"
            ? `Thinking is ${reasoning}.`
            : `Thinking is ${reasoning}. It applies when the model is Gemini.`,
        )
        continue
      }

      messages.push({ role: "user", content: line })
      const started = Date.now()
      let firstTokenAt: number | undefined
      let requestId = ""
      let assistant = ""
      try {
        for await (const event of stream(ai, current, { messages, reasoning })) {
          if (event.type === "meta") {
            requestId = event.id
            continue
          }
          if (event.type === "delta") {
            if (firstTokenAt === undefined && event.content) firstTokenAt = Date.now()
            assistant += event.content
            output.write(event.content)
            continue
          }
          if (event.type === "done") {
            if (!assistant && event.message.content) {
              assistant = event.message.content
              output.write(assistant)
            }
            messages.push({ role: "assistant", content: assistant || event.message.content })
            const wait =
              firstTokenAt === undefined ? "" : ` First word in ${seconds(firstTokenAt - started)}.`
            console.log()
            console.log()
            console.log(`${usageSentence(event.usage, requestId || event.requestIds?.[0])}${wait}`)
            console.log()
          }
        }
      } catch (error) {
        messages.pop()
        console.log()
        console.log(errorSentence(error))
      }
    }
  } finally {
    rl.close()
  }
}

main().catch((error: unknown) => {
  console.error(errorSentence(error))
  process.exit(1)
})
