import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import type { AInvoker, ChatMessage } from "ainvoker"
import { chat } from "../../shared/call.ts"
import { createClient } from "../../shared/client.ts"
import { createCounter, money, ORDER_SYSTEM } from "../../shared/counter.ts"
import { hasApiKey, loadSampleEnv } from "../../shared/env.ts"
import { errorSentence, usageSentence } from "../../shared/format.ts"
import { CATALOG, findEntry, parseModelArg, type CatalogEntry } from "../../shared/models.ts"

loadSampleEnv("module")

function printHelp(): void {
  console.log("Commands: /model, /ticket, /clear, /help, /quit")
  console.log("Reading the menu runs on its own. Adding or clearing asks you first.")
}

function printTicket(lines: { name: string; qty: number; price: number }[], total: number): void {
  console.log("Ticket")
  if (lines.length === 0) {
    console.log("  Empty.")
    return
  }
  for (const line of lines) {
    console.log(`  ${line.qty} ${line.name}  ${money(line.price * line.qty)}`)
  }
  console.log(`  Total ${money(total)}`)
}

async function main(): Promise<void> {
  if (!hasApiKey()) {
    console.error("Set AINVOKER_API_KEY in ainvoker_sample/.env")
    process.exit(1)
  }

  const ai: AInvoker = createClient()
  const rl = readline.createInterface({ input, output })
  const counter = createCounter()
  let current: CatalogEntry = CATALOG[0]
  const messages: ChatMessage[] = [{ role: "system", content: ORDER_SYSTEM }]

  console.log("Actions")
  console.log(`ai.text.chat with actions · ${current.label}`)
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
      if (line === "/ticket") {
        const snap = counter.snapshot()
        printTicket(snap.lines, snap.total)
        continue
      }
      if (line === "/clear") {
        counter.ticket.splice(0, counter.ticket.length)
        messages.splice(1)
        console.log("Ticket and conversation cleared.")
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
        const result = await chat(ai, current, {
          messages,
          tools: counter.tools,
          maxSteps: 8,
          reasoning: "minimal",
          approve: async (call) => {
            if (call.name === "read_menu") {
              console.log("read_menu")
              return true
            }
            const answer = (
              await rl.question(`allow ${call.name} ${JSON.stringify(call.arguments)}? [y/n] `)
            )
              .trim()
              .toLowerCase()
            return answer === "y" || answer === "yes"
          },
        })
        if (result.messages) {
          messages.splice(0, messages.length, ...result.messages)
        } else {
          messages.push(result.message)
        }
        console.log()
        for (const run of result.actionRuns ?? []) {
          const summary = run.result.ok
            ? JSON.stringify(run.result.output)
            : `${run.result.error.code}: ${run.result.error.message}`
          console.log(`${run.call.name}  ${summary}`)
        }
        if (result.message.content) console.log(result.message.content)
        console.log(usageSentence(result.usage, result.requestIds?.at(-1) ?? result.id))
        if (result.finishReason === "max_steps") {
          console.log("Stopped at the step limit. Send another message to continue.")
        }
        printTicket(counter.snapshot().lines, counter.snapshot().total)
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
