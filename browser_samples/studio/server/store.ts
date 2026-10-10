import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { cosine, embed, EMBEDDING_SOURCE, tokenize } from "./embeddings.ts"
import { SEED_NOTES } from "./seed.ts"

export type Note = { id: string; title: string; body: string; updatedAt: string }

export type Passage = { noteId: string; title: string; text: string; score: number }

type NoteRow = { id: string; title: string; body: string; updated_at: string }
type ChunkRow = { note_id: string; title: string; text: string; embedding: string }

const CHUNK_CHARS = 600

let db: DatabaseSync | undefined
let ready: Promise<void> | undefined

function toNote(row: NoteRow): Note {
  return { id: row.id, title: row.title, body: row.body, updatedAt: row.updated_at }
}

function chunk(body: string): string[] {
  const chunks: string[] = []
  let current = ""
  for (const paragraph of body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    if (current && current.length + paragraph.length > CHUNK_CHARS) {
      chunks.push(current)
      current = ""
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  if (current) chunks.push(current)
  return chunks
}

async function index(note: Note): Promise<void> {
  const database = open()
  const texts = chunk(note.body)
  const vectors = await embed(texts.map((text) => `${note.title}\n${text}`))
  database.prepare("DELETE FROM chunks WHERE note_id = ?").run(note.id)
  const insert = database.prepare(
    "INSERT INTO chunks (note_id, position, text, embedding, source) VALUES (?, ?, ?, ?, ?)",
  )
  texts.forEach((text, position) => {
    insert.run(note.id, position, text, JSON.stringify(vectors[position]), EMBEDDING_SOURCE)
  })
}

function open(): DatabaseSync {
  if (db) return db
  const dir = path.resolve(process.cwd(), "data")
  fs.mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(path.join(dir, "studio.db"))
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      source TEXT NOT NULL
    );
  `)
  return db
}

function allNotes(): Note[] {
  const rows = open().prepare("SELECT * FROM notes ORDER BY updated_at DESC").all() as NoteRow[]
  return rows.map(toNote)
}

async function insertNote(input: { title: string; body: string }): Promise<Note> {
  const note: Note = {
    id: crypto.randomUUID().slice(0, 8),
    title: input.title.trim(),
    body: input.body.trim(),
    updatedAt: new Date().toISOString(),
  }
  open()
    .prepare("INSERT INTO notes (id, title, body, updated_at) VALUES (?, ?, ?, ?)")
    .run(note.id, note.title, note.body, note.updatedAt)
  await index(note)
  return note
}

/** Opens the database, seeds it on first run, and rebuilds vectors made by an older source. */
function init(): Promise<void> {
  ready ??= (async () => {
    const database = open()
    const count = database.prepare("SELECT COUNT(*) AS count FROM notes").get() as { count: number }
    if (count.count === 0) {
      for (const seed of SEED_NOTES) await insertNote(seed)
      return
    }
    const stale = database
      .prepare("SELECT COUNT(*) AS count FROM chunks WHERE source != ?")
      .get(EMBEDDING_SOURCE) as { count: number }
    if (stale.count > 0) {
      for (const note of allNotes()) await index(note)
    }
  })()
  return ready
}

export async function listNotes(): Promise<Note[]> {
  await init()
  return allNotes()
}

export async function getNote(id: string): Promise<Note | null> {
  await init()
  const row = open().prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | undefined
  return row ? toNote(row) : null
}

export async function createNote(input: { title: string; body: string }): Promise<Note> {
  await init()
  return insertNote(input)
}

export async function updateNote(
  id: string,
  input: { title?: string; body?: string },
): Promise<Note | null> {
  const existing = await getNote(id)
  if (!existing) return null
  const note: Note = {
    id,
    title: input.title?.trim() || existing.title,
    body: input.body?.trim() || existing.body,
    updatedAt: new Date().toISOString(),
  }
  open()
    .prepare("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?")
    .run(note.title, note.body, note.updatedAt, id)
  await index(note)
  return note
}

export async function deleteNote(id: string): Promise<boolean> {
  await init()
  const database = open()
  database.prepare("DELETE FROM chunks WHERE note_id = ?").run(id)
  return database.prepare("DELETE FROM notes WHERE id = ?").run(id).changes > 0
}

/**
 * Hybrid retrieval: vector similarity plus the share of query words that appear
 * in the passage. The keyword half keeps exact names and numbers ranking well.
 */
export async function searchNotes(query: string, limit = 4): Promise<Passage[]> {
  await init()
  const [queryVector] = await embed([query])
  const queryWords = new Set(tokenize(query))
  const rows = open()
    .prepare(
      "SELECT chunks.note_id, notes.title, chunks.text, chunks.embedding FROM chunks JOIN notes ON notes.id = chunks.note_id",
    )
    .all() as ChunkRow[]

  return rows
    .map((row) => {
      const words = new Set(tokenize(`${row.title} ${row.text}`))
      const overlap = queryWords.size
        ? [...queryWords].filter((word) => words.has(word)).length / queryWords.size
        : 0
      const similarity = cosine(queryVector, JSON.parse(row.embedding) as number[])
      return {
        noteId: row.note_id,
        title: row.title,
        text: row.text,
        score: Math.round((0.5 * similarity + 0.5 * overlap) * 100) / 100,
      }
    })
    .filter((passage) => passage.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
