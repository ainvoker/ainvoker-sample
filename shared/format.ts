import { isAInvokerError } from "ainvoker"

function detailFromBody(body: unknown): string | null {
  if (typeof body !== "string") return null
  const pre = body.match(/<pre>([^<]+)<\/pre>/)
  if (pre?.[1]) return pre[1].trim()
  return null
}

export function errorSentence(error: unknown): string {
  if (isAInvokerError(error)) {
    const status = error.status > 0 ? `${error.status} ` : ""
    const detail = detailFromBody(error.body)
    return `${status}${error.code}: ${detail ?? error.message}`
  }
  if (error instanceof Error && error.message) return error.message
  return "The request failed."
}

export function usageSentence(
  usage: { inputTokens: number; outputTokens: number } | null,
  requestId?: string,
): string {
  const counts = usage
    ? `${usage.inputTokens} input tokens and ${usage.outputTokens} output tokens`
    : "token counts were not reported"
  if (requestId) return `Request ${requestId} used ${counts}.`
  return `${counts[0]?.toUpperCase() ?? ""}${counts.slice(1)}.`
}

export function seconds(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(1)} seconds`
}
