import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { studioApi } from "./server/plugin.ts"

export default defineConfig({
  plugins: [react(), studioApi()],
  server: {
    port: 5180,
    strictPort: true,
    watch: {
      ignored: ["**/data/**"],
    },
    fs: {
      // The SDK is linked from ../ainvoker_js, outside this sample folder.
      allow: [path.resolve(process.cwd(), "../.."), path.resolve(process.cwd(), "../../../ainvoker_js")],
    },
  },
})
