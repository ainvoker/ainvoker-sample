import { defineAction } from "ainvoker"
import { z } from "zod"

export const menu = [
  { name: "Oat latte", price: 4.5 },
  { name: "Batch brew", price: 3 },
  { name: "Cardamom bun", price: 3.5 },
  { name: "Sesame cookie", price: 2 },
  { name: "Cold brew", price: 4 },
  { name: "Pear soda", price: 3.25 },
] as const

export type TicketLine = { name: string; qty: number; price: number }

export const ORDER_SYSTEM = [
  "You take orders at Northline, a small cafe counter.",
  "Call read_menu before you name a price or recommend an item.",
  "Call add_item only with a name from that menu and a whole-number qty.",
  "Call clear_ticket only when the person wants to start over.",
  "After the tools finish, reply in one or two sentences.",
  "Mention the ticket total when it is not zero.",
  "If an action is declined or fails, do not repeat that same call.",
].join(" ")

const empty = z.object({})

const addItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive().max(12),
})

export function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function ticketTotal(lines: readonly TicketLine[]): number {
  return lines.reduce((sum, line) => sum + line.price * line.qty, 0)
}

export function createCounter() {
  const ticket: TicketLine[] = []

  const readMenu = defineAction({
    name: "read_menu",
    description: "Read the Northline menu, including prices in dollars.",
    runtime: "server",
    inputSchema: empty,
    method: () => menu.map((item) => ({ name: item.name, price: item.price })),
  })

  const addItem = defineAction({
    name: "add_item",
    description: "Add a menu item to the current ticket. The name must match the menu.",
    runtime: "server",
    inputSchema: addItemSchema,
    method: ({ name, qty }) => {
      const item = menu.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase())
      if (!item) throw new Error(`"${name}" is not on the menu`)
      const line = ticket.find((entry) => entry.name === item.name)
      if (line) line.qty += qty
      else ticket.push({ name: item.name, qty, price: item.price })
      return { added: item.name, qty, total: ticketTotal(ticket) }
    },
  })

  const clearTicket = defineAction({
    name: "clear_ticket",
    description: "Remove every line from the ticket.",
    runtime: "server",
    inputSchema: empty,
    method: () => {
      ticket.splice(0, ticket.length)
      return { cleared: true }
    },
  })

  return {
    ticket,
    tools: [readMenu, addItem, clearTicket],
    snapshot() {
      return {
        lines: ticket.map((line) => ({ ...line })),
        total: ticketTotal(ticket),
      }
    },
  }
}
