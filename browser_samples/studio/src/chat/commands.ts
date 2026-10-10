/**
 * Slash commands run without asking the model which tool to use. Tools the model
 * can call come from `/api/tools`; the palette lists both.
 */
export type Command = { name: string; args?: string; description: string }

export const COMMANDS: Command[] = [
  { name: "help", description: "List commands and the tools the assistant can use" },
  { name: "search", args: "query", description: "Show the handbook passages retrieval finds" },
  { name: "ask", args: "question", description: "One-shot answer with ai.action.invoke, no history" },
  { name: "image", args: "prompt", description: "Draw an image with ai.image.generate" },
  { name: "theme", args: "light | dark | system", description: "Run the set_theme action directly" },
  { name: "model", args: "provider/model", description: "Switch the chat model" },
  { name: "clear", description: "Clear the screen; the assistant still remembers" },
  { name: "new", description: "Start a new conversation" },
]

export function parseCommand(input: string): { name: string; rest: string } | null {
  const match = input.trim().match(/^\/(\S+)\s*([\s\S]*)$/)
  return match ? { name: match[1].toLowerCase(), rest: match[2].trim() } : null
}
