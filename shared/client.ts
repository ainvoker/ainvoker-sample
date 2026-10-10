import { AInvoker } from "ainvoker"

export function createClient(): AInvoker {
  const apiKey = process.env.AINVOKER_API_KEY?.trim() ?? ""
  if (!apiKey) {
    throw new Error("Set AINVOKER_API_KEY in ainvoker_sample/.env")
  }
  const baseUrl = process.env.AINVOKER_BASE_URL?.trim()
  return new AInvoker({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  })
}
