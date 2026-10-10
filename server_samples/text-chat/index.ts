import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import type { AInvoker, ChatMessage } from "ainvoker"
import { chat } from "../../shared/call.ts"
import { createClient } from "../../shared/client.ts"
import { loadSampleEnv, hasApiKey } from "../../shared/env.ts"
import { errorSentence, usageSentence } from "../../shared/format.ts"
import { CATALOG, findEntry, parseModelArg, type CatalogEntry } from "../../shared/models.ts"

loadSampleEnv("module")

const SYSTEM =
  "You are a concise assistant in a live demo of AInvoker. Answer in a few sentences."

function printHelp(): void {
  console.log("Commands: /model, /temp, /clear, /help, /quit")
  console.log(`Models: ${CATALOG.map((entry) => `${entry.provider}/${entry.model}`).join(", ")}`)
}

async function main(): Promise<void> {
  if (!hasApiKey()) {
    console.error("Set AINVOKER_API_KEY in ainvoker_sample/.env")
    process.exit(1)
  }

  const ai: AInvoker = createClient()
  const rl = readline.createInterface({ input, output })
  let current: CatalogEntry = CATALOG[1]
  let temperature = 0.7
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }]

  console.log("Text chat")
  console.log(`ai.text.chat · ${current.label} · temperature ${temperature}`)
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
      if (line.startsWith("/temp")) {
        const value = Number(line.slice("/temp".length).trim())
        if (!Number.isFinite(value) || value < 0 || value > 2) {
          console.log("Temperature must be a number from 0 to 2.")
          continue
        }
        temperature = value
        console.log(`Temperature is ${temperature}.`)
        continue
      }
      if (line.startsWith("/model")) {
        const parsed = parseModelArg(line.slice("/model".length))
        const next = parsed ? findEntry(parsed.provider, parsed.model) : undefined
        if (!next) {
          console.log("Usage: /model openai gpt-4o-mini")
          continue
        }
        current = next
        console.log(`Model is ${current.label}.`)
        continue
      }

      messages.push({ role: "user", content: line })
      try {
        const result = await chat(ai, current, { messages, temperature })
        messages.push({ role: "assistant", content: result.message.content })
        console.log()
        console.log(result.message.content)
        console.log()
        console.log(usageSentence(result.usage, result.id))
        console.log()
      } catch (error) {
        messages.pop()
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
