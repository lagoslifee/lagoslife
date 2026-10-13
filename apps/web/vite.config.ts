import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * `/server.json` names the game server this build talks to. Open tabs poll it, so when the testing tunnel moves and
 * the site is rebuilt they reload onto the new address instead of failing every request to the old one.
 */
const serverManifest = (): Plugin => ({
  name: "server-manifest",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "server.json", source: JSON.stringify({ apiUrl: process.env.VITE_API_URL ?? null }) });
  },
});

export default defineConfig({
  plugins: [react(), serverManifest()],
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    // Babylon is about 2 MB minified and changes far less often than game code;
    // keeping it in its own content-hashed chunk lets browsers cache it across releases.
    chunkSizeWarningLimit: 2600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "babylon", test: /node_modules[\\/]@babylonjs[\\/]/, priority: 2, entriesAware: true },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
