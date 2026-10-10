export type Note = { id: string; title: string; body: string; updatedAt: string }

export type Passage = { noteId: string; title: string; text: string; score: number }

export type ToolInfo = {
  name: string
  description: string
  runtime: "server" | "browser" | "universal"
  asks: boolean
  example: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** JSON request that throws the server's message on failure. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new Error("This page could not reach its server. Is npm run studio still running?")
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(isRecord(body) && typeof body.message === "string" ? body.message : `Request failed (${response.status}).`)
  }
  return body as T
}
