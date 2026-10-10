import { useCallback, useEffect, useState } from "react"
import { applyTheme, type Theme } from "./actions/browser.ts"
import { api, type Note } from "./api.ts"
import { ChatPane } from "./chat/ChatPane.tsx"
import { NotesPane, type Editing } from "./notes/NotesPane.tsx"

function savedTheme(): Theme {
  const value = localStorage.getItem("studio-theme")
  return value === "light" || value === "dark" ? value : "system"
}

export function App() {
  const [ready, setReady] = useState<boolean | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [changedId, setChangedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [problem, setProblem] = useState("")
  const [theme, setTheme] = useState<Theme>(savedTheme)

  const refreshNotes = useCallback(async (focusId?: string) => {
    try {
      const list = await api<Note[]>("/api/notes")
      setNotes(list)
      setProblem("")
      if (focusId) {
        setSelectedId(focusId)
        setEditing(null)
        setChangedId(focusId)
      }
      setSelectedId((current) => (current && list.some((note) => note.id === current) ? current : null))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not load the notes.")
    }
  }, [])

  useEffect(() => {
    void refreshNotes()
    api<{ ready: boolean }>("/api/health").then(
      (body) => setReady(body.ready),
      () => setReady(false),
    )
  }, [refreshNotes])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const { id } = (event as CustomEvent<{ id: string }>).detail
      setSelectedId(id)
      setEditing(null)
    }
    const onDraft = (event: Event) => {
      const { title, body } = (event as CustomEvent<{ title: string; body: string }>).detail
      setEditing({ title, body, drafted: true })
    }
    const onTheme = (event: Event) => setTheme((event as CustomEvent<Theme>).detail)
    window.addEventListener("studio:open-note", onOpen)
    window.addEventListener("studio:draft", onDraft)
    window.addEventListener("studio:theme", onTheme)
    return () => {
      window.removeEventListener("studio:open-note", onOpen)
      window.removeEventListener("studio:draft", onDraft)
      window.removeEventListener("studio:theme", onTheme)
    }
  }, [])

  useEffect(() => {
    if (theme !== "system") return
    const query = matchMedia("(prefers-color-scheme: dark)")
    const follow = () => applyTheme("system")
    query.addEventListener("change", follow)
    return () => query.removeEventListener("change", follow)
  }, [theme])

  useEffect(() => {
    if (!changedId) return
    const timer = setTimeout(() => setChangedId(null), 2400)
    return () => clearTimeout(timer)
  }, [changedId])

  async function save(next: Editing) {
    try {
      const body = { title: next.title, body: next.body }
      const note = next.id
        ? await api<Note>(`/api/notes/${encodeURIComponent(next.id)}`, { method: "PUT", body })
        : await api<Note>("/api/notes", { body })
      await refreshNotes(note.id)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not save the note.")
    }
  }

  async function remove(note: Note) {
    if (!confirm(`Delete “${note.title}”? This cannot be undone.`)) return
    try {
      await api(`/api/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" })
      await refreshNotes()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not delete the note.")
    }
  }

  const dark = document.documentElement.dataset.theme === "dark"

  return (
    <div className="studio">
      <header className="masthead">
        <p className="mark">
          Northline <span>handbook</span>
        </p>
        <p className="key">
          {ready === null
            ? "Checking the key…"
            : ready
              ? "Key loaded from ainvoker_sample/.env"
              : "Add AINVOKER_API_KEY to ainvoker_sample/.env to use the assistant"}
        </p>
        <button type="button" className="quiet-button" onClick={() => applyTheme(dark ? "light" : "dark")}>
          {dark ? "Light theme" : "Dark theme"}
        </button>
      </header>
      <NotesPane
        notes={notes}
        selectedId={selectedId}
        changedId={changedId}
        editing={editing}
        problem={problem}
        onSelect={(id) => {
          setSelectedId(id)
          setEditing(null)
        }}
        onEdit={setEditing}
        onSave={(next) => void save(next)}
        onDelete={(note) => void remove(note)}
      />
      <ChatPane
        ready={ready}
        onNotesChanged={(focusId) => void refreshNotes(focusId)}
        onOpenNote={(id) => {
          setSelectedId(id)
          setEditing(null)
        }}
      />
    </div>
  )
}
