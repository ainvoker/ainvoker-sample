import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { fileURLToPath } from "node:url"
import type { AInvoker, ImageQuality } from "ainvoker"
import { createClient } from "../../shared/client.ts"
import { loadSampleEnv, hasApiKey } from "../../shared/env.ts"
import { errorSentence, seconds, usageSentence } from "../../shared/format.ts"

loadSampleEnv("module")

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../output")
const QUALITIES: ImageQuality[] = ["low", "medium", "high", "xhigh", "max", "auto"]
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

function printHelp(): void {
  console.log("Type a prompt to draw it. Commands: /quality, /help, /quit")
  console.log(`Qualities: ${QUALITIES.join(", ")}`)
}

async function main(): Promise<void> {
  if (!hasApiKey()) {
    console.error("Set AINVOKER_API_KEY in ainvoker_sample/.env")
    process.exit(1)
  }

  const ai: AInvoker = createClient()
  const rl = readline.createInterface({ input, output })
  let quality: ImageQuality = "low"

  console.log("Image generation")
  console.log(`ai.image.generate · openai/gpt-image-2.5-flare · quality ${quality}`)
  console.log("Needs a Pro or Scale workspace. Images are saved to ainvoker_sample/output.")
  printHelp()
  console.log()

  try {
    for (;;) {
      const line = (await rl.question("prompt> ")).trim()
      if (!line) continue
      if (line === "/quit") break
      if (line === "/help") {
        printHelp()
        continue
      }
      if (line.startsWith("/quality")) {
        const value = line.slice("/quality".length).trim() as ImageQuality
        if (!QUALITIES.includes(value)) {
          console.log(`Quality must be one of: ${QUALITIES.join(", ")}`)
          continue
        }
        quality = value
        console.log(`Quality is ${quality}.`)
        continue
      }

      const started = Date.now()
      try {
        const result = await ai.image.generate({
          provider: "openai",
          model: "gpt-image-2.5-flare",
          prompt: line,
          quality,
        })
        await mkdir(OUTPUT_DIR, { recursive: true })
        const extension = EXTENSIONS[result.image.mimeType] ?? "png"
        const file = path.join(OUTPUT_DIR, `${result.id}.${extension}`)
        await writeFile(file, Buffer.from(result.image.base64, "base64"))
        console.log()
        console.log(`Saved ${file} after ${seconds(Date.now() - started)}.`)
        console.log(usageSentence(result.usage, result.id))
        console.log()
      } catch (error) {
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
