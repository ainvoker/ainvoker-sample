import { defineAction } from "ainvoker"
import { z } from "zod"

/**
 * Actions that change this page. The server sends their tool definitions to the
 * model; when the model calls one, the server hands the call to this tab, which
 * runs it here with `action.run` and posts the tool result back. Methods only
 * touch the DOM when they run, so the server can import this file safely.
 */

export const THEMES = ["light", "dark", "system"] as const
export type Theme = (typeof THEMES)[number]

export function applyTheme(theme: Theme): "light" | "dark" {
  const resolved =
    theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme
  document.documentElement.dataset.theme = resolved
  localStorage.setItem("studio-theme", theme)
  window.dispatchEvent(new CustomEvent("studio:theme", { detail: theme }))
  return resolved
}

export const setTheme = defineAction({
  name: "set_theme",
  description: "Switch this page to light or dark. Use system to follow the device setting.",
  runtime: "browser",
  inputSchema: z.object({ theme: z.enum(THEMES) }),
  method: ({ theme }) => ({ theme, showing: applyTheme(theme) }),
})

export const openNote = defineAction({
  name: "open_note",
  description:
    "Open a handbook note in the reader so the person can see it. Use an id returned by search_notes or list_notes.",
  runtime: "browser",
  inputSchema: z.object({ id: z.string().min(1) }),
  method: async ({ id }) => {
    const response = await fetch(`/api/notes/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error(`No note has the id "${id}"`)
    const note = (await response.json()) as { id: string; title: string }
    window.dispatchEvent(new CustomEvent("studio:open-note", { detail: { id: note.id } }))
    return { opened: note.title }
  },
})

export const startDraft = defineAction({
  name: "start_draft",
  description:
    "Open the note editor with a suggested title and body, unsaved, so the person can edit and save it themselves. Use this instead of create_note when they want to review the wording first.",
  runtime: "browser",
  inputSchema: z.object({ title: z.string().min(1).max(120), body: z.string().min(1) }),
  method: (draft) => {
    window.dispatchEvent(new CustomEvent("studio:draft", { detail: draft }))
    return { drafted: draft.title, saved: false }
  },
})

export const BROWSER_ACTIONS = [setTheme, openNote, startDraft]

export function describeBrowserResult(name: string, output: unknown): string {
  const value = (output ?? {}) as Record<string, unknown>
  if (name === "set_theme") return `Theme set to ${String(value.theme)}.`
  if (name === "open_note") return `Opened “${String(value.opened)}”.`
  if (name === "start_draft") return `Draft “${String(value.drafted)}” is open in the editor, not saved yet.`
  return "Done."
}
