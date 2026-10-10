import Markdown from "react-markdown"
import type { Passage } from "../api.ts"

export type ToolState = "running" | "asking" | "ok" | "failed" | "declined"

export type Row =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; live: boolean; via?: string }
  | {
      kind: "tool"
      key: string
      name: string
      args: Record<string, unknown>
      runtime?: string
      state: ToolState
      detail?: string
      prompt?: string
    }
  | { kind: "image"; key: string; url: string; prompt?: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "passages"; key: string; query: string; source: string; passages: Passage[] }
  | { kind: "error"; key: string; text: string }

const WHERE: Record<string, string> = {
  server: "on the server",
  universal: "on the server (universal)",
  browser: "in this tab",
}

const STATE: Record<ToolState, string> = {
  running: "Running",
  asking: "Waiting for you",
  ok: "Done",
  failed: "Failed",
  declined: "Declined",
}

function ToolRow({
  row,
  onDecide,
}: {
  row: Extract<Row, { kind: "tool" }>
  onDecide: (id: string, allow: boolean) => void
}) {
  const args = Object.keys(row.args).length ? JSON.stringify(row.args, null, 2) : ""
  return (
    <div className={`tool tool-${row.state}`} data-runtime={row.runtime}>
      <p className="tool-line">
        <span className="tool-name">{row.name}</span>
        <span className="tool-where">{row.runtime ? WHERE[row.runtime] : ""}</span>
        <span className="tool-state">{STATE[row.state]}</span>
      </p>
      {row.detail ? <p className="tool-detail">{row.detail}</p> : null}
      {row.state === "asking" ? (
        <div className="approval">
          <p>{row.prompt}</p>
          <div className="approval-actions">
            <button type="button" className="allow" onClick={() => onDecide(row.key, true)}>
              Allow
            </button>
            <button type="button" className="quiet-button" onClick={() => onDecide(row.key, false)}>
              Decline
            </button>
          </div>
        </div>
      ) : null}
      {args ? (
        <details className="tool-args">
          <summary>Arguments</summary>
          <pre>{args}</pre>
        </details>
      ) : null}
    </div>
  )
}

export function Transcript({
  rows,
  onDecide,
  onOpenNote,
}: {
  rows: Row[]
  onDecide: (id: string, allow: boolean) => void
  onOpenNote: (id: string) => void
}) {
  return (
    <>
      {rows.map((row) => {
        switch (row.kind) {
          case "user":
            return (
              <p key={row.key} className="turn-user">
                {row.text}
              </p>
            )
          case "assistant":
            return (
              <div key={row.key} className="turn-assistant">
                <Markdown>{row.text}</Markdown>
                {row.live ? <span className="caret" aria-hidden="true" /> : null}
                {row.via ? <p className="via">{row.via}</p> : null}
              </div>
            )
          case "tool":
            return <ToolRow key={row.key} row={row} onDecide={onDecide} />
          case "image":
            return (
              <figure key={row.key} className="drawn">
                <a href={row.url} target="_blank" rel="noreferrer">
                  <img src={row.url} alt={row.prompt ?? "Generated image"} />
                </a>
                {row.prompt ? <figcaption>{row.prompt}</figcaption> : null}
              </figure>
            )
          case "notice":
            return (
              <div key={row.key} className="notice">
                <Markdown>{row.text}</Markdown>
              </div>
            )
          case "passages":
            return (
              <div key={row.key} className="passages">
                <p className="passages-head">
                  {row.passages.length
                    ? `Retrieval found ${row.passages.length} passage${row.passages.length === 1 ? "" : "s"} for “${row.query}”, ranked with ${row.source} vectors and keyword overlap.`
                    : `Nothing in the handbook matched “${row.query}”.`}
                </p>
                {row.passages.map((passage, index) => (
                  <blockquote key={`${passage.noteId}-${index}`}>
                    <p>{passage.text}</p>
                    <footer>
                      <button type="button" className="link-button" onClick={() => onOpenNote(passage.noteId)}>
                        {passage.title}
                      </button>{" "}
                      scored {passage.score.toFixed(2)}
                    </footer>
                  </blockquote>
                ))}
              </div>
            )
          case "error":
            return (
              <p key={row.key} className="turn-error" role="alert">
                {row.text}
              </p>
            )
        }
      })}
    </>
  )
}
