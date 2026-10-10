# AInvoker samples

Pitch demos for the SDK. Every app reads `ainvoker_sample/.env`.

## Setup

```bash
cd ainvoker_sample
npm install
```

Copy `.env.example` to `.env` if you do not already have one, then set `AINVOKER_API_KEY` to a project key (`ain_…`). Studio reads that file on each request, so refresh the page after you save it. Terminal samples read it when they start.

## Run

From this folder:

```bash
npm run chat
npm run stream
npm run actions
npm run image
npm run studio
```

On PowerShell, `.\scripts\run.ps1 chat` (also `stream`, `actions`, `image`, `studio`).

| Sample | Address | What it shows |
| --- | --- | --- |
| `chat` | terminal | `ai.text.chat`. Full reply, model switch, temperature, token counts. |
| `stream` | terminal | `ai.text.stream`. Tokens as they arrive. Gemini thinking depth. |
| `actions` | terminal | `ai.action.define` on `ai.text.chat`. Your functions run here. Writes ask before they run. |
| `image` | terminal | `ai.image.generate`. Prompt in, image file out under `output/`. Needs a Pro or Scale workspace. |
| `studio` | http://localhost:5180 | Every SDK feature in one app: a team handbook with an assistant beside it. |

## Studio

Studio is the Northline cafe handbook: notes you can create, edit, and delete, with an assistant panel on the right. It needs Node 22.13 or newer because notes are stored with the built-in `node:sqlite` module in `browser_samples/studio/data/` (ignored by git; delete the folder to reset to the seed notes).

Ask in plain words and the model chooses the tools. Type `/` for commands that run without the model choosing.

| SDK feature | Where to see it |
| --- | --- |
| `ai.text.stream` | Every chat reply streams in. Tool calls and results appear as they happen. |
| Server actions (`runtime: "server"`) | `search_notes`, `list_notes`, `create_note`, `update_note`, `delete_note`. The SDK runs them inside its loop. |
| `approve` | `update_note` and `delete_note` wait for Allow or Decline in the chat. |
| Universal action | `get_weather` calls the public Open-Meteo API with plain `fetch`. |
| Browser actions (`runtime: "browser"`) | `set_theme`, `open_note`, `start_draft` run in the tab. See below. |
| `ai.image.generate` | Ask for a picture, or `/image <prompt>`. Needs a Pro or Scale workspace. |
| `ai.action.invoke` | `/ask <question>` answers once, outside the conversation. |
| `reasoning` | Pick a Gemini model and a thinking level appears next to it. |
| Retrieval (RAG) | Notes are chunked and embedded on save. `search_notes` and `/search <query>` rank passages by vector similarity plus keyword overlap. |

Commands: `/help`, `/search`, `/ask`, `/image`, `/theme`, `/model`, `/clear`, `/new`.

### Browser actions without a key in the browser

The key stays on the dev server, so the model is called from there. Browser actions are sent to the model as plain tool definitions (`action.toTool()`). When the model calls one, the SDK stops its loop with `finishReason: "tool_calls"`. The server forwards the call to the tab over the open event stream, the tab runs it with `action.run(call)`, posts the tool message to `/api/tool-result`, and the server continues the turn with those messages. Server actions in the same turn still run automatically.

### Embeddings

The SDK has no embeddings call yet. `browser_samples/studio/server/embeddings.ts` hashes words into vectors locally so the whole retrieval path (chunk, embed, store, cosine) already works. When `ai.embeddings` ships, swap the body of `embed` for the SDK call; stored vectors are rebuilt on the next start.

### Gemini

Gemini's stream separates a function call from the thought signature the next step needs, and the gateway then rejects that step. On Gemini models Studio runs tool turns with `ai.text.chat` and replays the result as the same events, so replies arrive in one piece.
