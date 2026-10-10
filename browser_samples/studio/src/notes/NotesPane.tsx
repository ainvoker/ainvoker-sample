import { useMemo, useState } from "react"
import type { Note } from "../api.ts"

export type Editing = { id?: string; title: string; body: string; drafted?: boolean }

const updated = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })

export function NotesPane({
  notes,
  selectedId,
  changedId,
  editing,
  problem,
  onSelect,
  onEdit,
  onSave,
  onDelete,
}: {
  notes: Note[]
  selectedId: string | null
  changedId: string | null
  editing: Editing | null
  problem: string
  onSelect: (id: string) => void
  onEdit: (editing: Editing | null) => void
  onSave: (editing: Editing) => void
  onDelete: (note: Note) => void
}) {
  const [filter, setFilter] = useState("")
  const visible = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return notes.filter((note) => words.every((word) => `${note.title} ${note.body}`.toLowerCase().includes(word)))
  }, [notes, filter])
  const selected = notes.find((note) => note.id === selectedId) ?? null

  return (
    <section className="handbook" aria-label="Handbook">
      <nav className="shelf" aria-label="Notes">
        <input
          type="search"
          className="filter"
          placeholder="Filter notes"
          aria-label="Filter notes"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button type="button" className="quiet-button new-note" onClick={() => onEdit({ title: "", body: "" })}>
          New note
        </button>
        <ul>
          {visible.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                aria-current={note.id === selectedId && !editing ? "true" : undefined}
                className={note.id === changedId ? "shelf-item changed" : "shelf-item"}
                onClick={() => onSelect(note.id)}
              >
                {note.title}
              </button>
            </li>
          ))}
        </ul>
        {visible.length === 0 ? <p className="hint">{notes.length ? "No note matches that filter." : "No notes yet."}</p> : null}
      </nav>

      <article className="page">
        {problem ? (
          <p className="problem" role="alert">
            {problem}
          </p>
        ) : null}
        {editing ? (
          <form
            className="editor"
            onSubmit={(event) => {
              event.preventDefault()
              onSave(editing)
            }}
          >
            {editing.drafted ? (
              <p className="drafted">The assistant drafted this. Nothing is saved until you press Save note.</p>
            ) : null}
            <label className="visually-hidden" htmlFor="note-title">
              Title
            </label>
            <input
              id="note-title"
              className="title-input"
              placeholder="Title"
              value={editing.title}
              onChange={(event) => onEdit({ ...editing, title: event.target.value })}
              autoFocus
            />
            <label className="visually-hidden" htmlFor="note-body">
              Note
            </label>
            <textarea
              id="note-body"
              className="body-input"
              placeholder="Write the note. Leave a blank line between paragraphs."
              value={editing.body}
              onChange={(event) => onEdit({ ...editing, body: event.target.value })}
            />
            <div className="page-actions">
              <button className="send" type="submit" disabled={!editing.title.trim() || !editing.body.trim()}>
                Save note
              </button>
              <button className="quiet-button" type="button" onClick={() => onEdit(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : selected ? (
          <>
            <h1>{selected.title}</h1>
            <p className="updated">Updated {updated.format(new Date(selected.updatedAt))}</p>
            <div className="prose">
              {selected.body.split(/\n\s*\n/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <div className="page-actions">
              <button
                className="quiet-button"
                type="button"
                onClick={() => onEdit({ id: selected.id, title: selected.title, body: selected.body })}
              >
                Edit
              </button>
              <button className="quiet-button danger" type="button" onClick={() => onDelete(selected)}>
                Delete
              </button>
            </div>
          </>
        ) : (
          <div className="blank">
            <h1>Northline handbook</h1>
            <p>
              How the counter runs, written down. Pick a note on the left, or ask the assistant. It answers from these
              notes and can add to them.
            </p>
          </div>
        )}
      </article>
    </section>
  )
}
