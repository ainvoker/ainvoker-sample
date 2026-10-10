export async function readSse(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<void> {
  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status}).`
    try {
      const body: unknown = await response.json()
      if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
        message = body.message
      }
    } catch {
      /* The status line is enough when the body is not JSON. */
    }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const split = buffer.indexOf("\n\n")
      if (split < 0) break
      const chunk = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
      if (!data) continue
      onEvent(JSON.parse(data) as unknown)
    }
  }
}
