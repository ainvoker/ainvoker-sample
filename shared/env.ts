import { parse } from "dotenv"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function envFilePath(mode: "module" | "app"): string {
  return mode === "app"
    ? path.resolve(process.cwd(), "../../.env")
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env")
}

/**
 * Read ainvoker_sample/.env into process.env.
 * `module` resolves next to this file (server scripts run with tsx).
 * `app` resolves from a browser sample's working directory.
 * Values already in the file replace older ones, so saving .env is picked up
 * on the next request without restarting the dev server.
 */
export function loadSampleEnv(mode: "module" | "app" = "module"): void {
  const envPath = envFilePath(mode)
  if (!fs.existsSync(envPath)) return
  const values = parse(fs.readFileSync(envPath))
  for (const key of ["AINVOKER_API_KEY", "AINVOKER_BASE_URL"] as const) {
    if (values[key] === undefined) continue
    process.env[key] = values[key].trim()
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.AINVOKER_API_KEY?.trim())
}
