import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { ToolInfo } from "../api.ts"
import { COMMANDS } from "./commands.ts"

type Item =
  | { kind: "command"; name: string; args?: string; description: string }
  | { kind: "tool"; name: string; description: string; example: string; where: string }

const WHERE: Record<ToolInfo["runtime"], string> = {
  server: "runs on the server",
  universal: "runs anywhere",
  browser: "runs in this tab",
}

export function Composer({
  value,
  onChange,
  onSend,
  busy,
  tools,
}: {
  value: string
  onChange: (value: string) => void
  onSend: (value: string) => void
  busy: boolean
  tools: ToolInfo[]
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const query = /^\/\S*$/.test(value) ? value.slice(1).toLowerCase() : null
  const items = useMemo<Item[]>(() => {
    if (query === null) return []
    const commands: Item[] = COMMANDS.filter((command) => command.name.startsWith(query)).map((command) => ({
      kind: "command",
      ...command,
    }))
    const matches: Item[] = tools
      .filter((tool) => tool.name.includes(query) && tool.example)
      .map((tool) => ({
        kind: "tool",
        name: tool.name,
        description: tool.asks ? `${tool.description} Asks before it runs.` : tool.description,
        example: tool.example,
        where: WHERE[tool.runtime],
      }))
    return [...commands, ...matches]
  }, [query, tools])
  const open = items.length > 0 && !dismissed

  useEffect(() => {
    setActive(0)
    if (query === null) setDismissed(false)
  }, [query])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  function pick(item: Item) {
    if (item.kind === "tool") onChange(item.example)
    else if (item.args) onChange(`/${item.name} `)
    else onSend(`/${item.name}`)
    ref.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setActive((index) => (index + step + items.length) % items.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        pick(items[active])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (value.trim() && !busy) onSend(value)
    }
  }

  const firstTool = items.findIndex((item) => item.kind === "tool")

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim() && !busy) onSend(value)
      }}
    >
      {open ? (
        <ul className="palette" role="listbox" id="palette" aria-label="Commands and tools">
          {items.map((item, index) => (
            <li key={`${item.kind}-${item.name}`} role="presentation">
              {index === 0 && item.kind === "command" ? <p className="palette-group">Commands</p> : null}
              {index === firstTool ? <p className="palette-group">Ask the assistant to use a tool</p> : null}
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? "palette-item active" : "palette-item"}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(item)}
              >
                <span className="palette-name">
                  {item.kind === "command" ? `/${item.name}` : item.name}
                  {item.kind === "command" && item.args ? <span className="palette-args"> {item.args}</span> : null}
                  {item.kind === "tool" ? <span className="palette-args"> {item.where}</span> : null}
                </span>
                <span className="palette-description">{item.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="visually-hidden" htmlFor="composer-input">
        Message the assistant
      </label>
      <textarea
        id="composer-input"
        ref={ref}
        rows={2}
        value={value}
        placeholder={busy ? "Working…" : "Ask about the handbook, or type / for commands"}
        role="combobox"
        aria-expanded={open}
        aria-controls="palette"
        aria-autocomplete="list"
        onChange={(event) => {
          onChange(event.target.value)
          setDismissed(false)
        }}
        onKeyDown={onKeyDown}
      />
      <button className="send" type="submit" disabled={busy || !value.trim()}>
        Send
      </button>
    </form>
  )
}
