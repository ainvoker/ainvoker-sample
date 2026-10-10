import { defineAction, type Action } from "ainvoker"
import { z } from "zod"
import { createClient } from "../../../shared/client.ts"
import { BROWSER_ACTIONS } from "../src/actions/browser.ts"
import { drawImage } from "./images.ts"
import { createNote, deleteNote, getNote, listNotes, searchNotes, updateNote } from "./store.ts"

/** Actions that change saved data wait for Allow in the chat. */
export const NEEDS_APPROVAL = new Set(["update_note", "delete_note"])

/** Actions whose success means the note list on the page is out of date. */
export const CHANGES_NOTES = new Set(["create_note", "update_note", "delete_note"])

const EXAMPLES: Record<string, string> = {
  search_notes: "What's the lead time on oat milk, and when do I need to order?",
  list_notes: "Which notes are in the handbook?",
  create_note: "Add a note: the right grinder was serviced today and needs no changes.",
  update_note: "Update the cold brew note: one batch now keeps for seven days, not ten.",
  delete_note: "Delete the remakes and refunds note.",
  get_weather: "What's the weather in Portland today? Should we start a second cold brew batch?",
  generate_image: "Draw a chalkboard sign announcing the spring menu.",
  set_theme: "Switch to dark mode.",
  open_note: "Open the espresso dial-in note.",
  start_draft: "Draft a closing checklist for me to review.",
}

async function noteOrThrow(id: string) {
  const note = await getNote(id)
  if (!note) throw new Error(`No note has the id "${id}". Call search_notes or list_notes to find it.`)
  return note
}

async function weatherFor(city: string) {
  const place = (await (
    await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`)
  ).json()) as { results?: Array<{ name: string; country: string; latitude: number; longitude: number }> }
  const match = place.results?.[0]
  if (!match) throw new Error(`Could not find a place called "${city}"`)
  const forecast = (await (
    await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${match.latitude}&longitude=${match.longitude}&current=temperature_2m,wind_speed_10m,precipitation&daily=temperature_2m_max&forecast_days=1&timezone=auto`,
    )
  ).json()) as {
    current?: { temperature_2m: number; wind_speed_10m: number; precipitation: number }
    daily?: { temperature_2m_max: number[] }
  }
  if (!forecast.current) throw new Error("The weather service did not return current conditions")
  return {
    place: `${match.name}, ${match.country}`,
    temperatureC: forecast.current.temperature_2m,
    highTodayC: forecast.daily?.temperature_2m_max[0],
    windKmh: forecast.current.wind_speed_10m,
    precipitationMm: forecast.current.precipitation,
  }
}

export const SERVER_ACTIONS: Action[] = [
  defineAction({
    name: "search_notes",
    description:
      "Search the Northline handbook and return the most relevant passages with their note ids. Call this before answering any question about how the cafe works.",
    runtime: "server",
    inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(8).optional() }),
    method: async ({ query, limit }) => {
      const passages = await searchNotes(query, limit)
      return passages.length ? passages : { passages: [], hint: "Nothing in the handbook matched." }
    },
  }),
  defineAction({
    name: "list_notes",
    description: "List every note in the handbook with its id and title.",
    runtime: "server",
    inputSchema: z.object({}),
    method: async () => (await listNotes()).map((note) => ({ id: note.id, title: note.title })),
  }),
  defineAction({
    name: "create_note",
    description: "Save a new note to the handbook right away.",
    runtime: "server",
    inputSchema: z.object({ title: z.string().min(1).max(120), body: z.string().min(1) }),
    method: async (input) => {
      const note = await createNote(input)
      return { id: note.id, title: note.title }
    },
  }),
  defineAction({
    name: "update_note",
    description:
      "Replace the title or body of an existing note. Send the full new body, not a diff. Read the note first so nothing is lost.",
    runtime: "server",
    inputSchema: z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(120).optional(),
      body: z.string().min(1).optional(),
    }),
    method: async ({ id, ...changes }) => {
      await noteOrThrow(id)
      const note = await updateNote(id, changes)
      return { id, title: note?.title }
    },
  }),
  defineAction({
    name: "delete_note",
    description: "Delete a note from the handbook.",
    runtime: "server",
    inputSchema: z.object({ id: z.string().min(1) }),
    method: async ({ id }) => {
      const note = await noteOrThrow(id)
      await deleteNote(id)
      return { deleted: note.title }
    },
  }),
  defineAction({
    name: "get_weather",
    description: "Get current weather and today's high for a city from the public Open-Meteo API.",
    // Plain fetch works anywhere, so this action could run in a browser too.
    runtime: "universal",
    inputSchema: z.object({ city: z.string().min(1) }),
    method: ({ city }) => weatherFor(city),
  }),
  defineAction({
    name: "generate_image",
    description:
      "Draw an image with the image model and show it in the chat. Only call this when the person asks for a picture, sign, or illustration.",
    runtime: "server",
    inputSchema: z.object({
      prompt: z.string().min(1),
      size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
    }),
    method: async ({ prompt, size }) => {
      const image = await drawImage(createClient(), prompt, size)
      // Only the id goes back to the model; the bytes stay on this server.
      return { imageId: image.id, url: image.url, revisedPrompt: image.revisedPrompt }
    },
  }),
]

/** Every tool the model can call, for the slash palette and `/help`. */
export function toolCatalog() {
  return [...SERVER_ACTIONS, ...BROWSER_ACTIONS].map((action) => ({
    name: action.name,
    description: action.description ?? "",
    runtime: action.runtime,
    asks: NEEDS_APPROVAL.has(action.name),
    example: EXAMPLES[action.name] ?? "",
  }))
}

export async function approvalPrompt(name: string, args: Record<string, unknown>): Promise<string> {
  const id = typeof args.id === "string" ? args.id : ""
  const title = (await getNote(id))?.title ?? id
  if (name === "delete_note") return `Delete “${title}”?`
  if (name === "update_note") return `Save changes to “${title}”?`
  return `Allow ${name}?`
}

/** One line for the transcript describing what an action did. */
export function summarize(name: string, output: unknown): string {
  const value = output as Record<string, unknown> | unknown[] | null
  if (name === "search_notes") {
    const count = Array.isArray(value) ? value.length : 0
    return count ? `Found ${count} passage${count === 1 ? "" : "s"}.` : "Nothing matched."
  }
  if (name === "list_notes" && Array.isArray(value)) return `Listed ${value.length} notes.`
  if (!value || Array.isArray(value)) return "Done."
  if (name === "create_note") return `Saved “${String(value.title)}”.`
  if (name === "update_note") return `Updated “${String(value.title)}”.`
  if (name === "delete_note") return `Deleted “${String(value.deleted)}”.`
  if (name === "get_weather") return `${String(value.place)}: ${String(value.temperatureC)} °C now.`
  if (name === "generate_image") return "Image ready."
  return "Done."
}
