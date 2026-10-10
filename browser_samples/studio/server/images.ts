import type { AInvoker, ChatUsage, ImageSize } from "ainvoker"

type StoredImage = { mimeType: string; bytes: Buffer }

const KEEP = 24
const images = new Map<string, StoredImage>()

export type DrawnImage = {
  id: string
  url: string
  revisedPrompt?: string
  usage: ChatUsage | null
}

/** The gateway does not keep image bytes, so the sample holds the latest few in memory. */
export async function drawImage(ai: AInvoker, prompt: string, size: ImageSize = "1024x1024"): Promise<DrawnImage> {
  const result = await ai.image.generate({
    provider: "openai",
    model: "gpt-image-2.5-flare",
    prompt,
    size,
    quality: "low",
  })
  images.set(result.id, { mimeType: result.image.mimeType, bytes: Buffer.from(result.image.base64, "base64") })
  for (const key of images.keys()) {
    if (images.size <= KEEP) break
    images.delete(key)
  }
  return {
    id: result.id,
    url: `/api/images/${encodeURIComponent(result.id)}`,
    revisedPrompt: result.image.revisedPrompt,
    usage: result.usage,
  }
}

export function getImage(id: string): StoredImage | undefined {
  return images.get(id)
}
