export const CATALOG = [
  { provider: "openai", model: "gpt-4o-mini", label: "OpenAI gpt-4o-mini" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { provider: "gemini", model: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
] as const

export type CatalogEntry = (typeof CATALOG)[number]
export type ProviderName = CatalogEntry["provider"]

export const REASONING = ["minimal", "low", "medium", "high"] as const
export type ReasoningLevel = (typeof REASONING)[number]

export function findEntry(provider: string, model: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.provider === provider && entry.model === model)
}

/** `/model openai gpt-4o-mini` or `/model openai/gpt-4o-mini`. */
export function parseModelArg(input: string): { provider: string; model: string } | null {
  const parts = input.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1 && parts[0]?.includes("/")) {
    const [provider, model] = parts[0].split("/")
    if (!provider || !model) return null
    return { provider, model }
  }
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { provider: parts[0], model: parts[1] }
  }
  return null
}
