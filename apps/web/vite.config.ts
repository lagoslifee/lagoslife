import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * `/server.json` lists the game server addresses (live and standby). Open tabs re-read it whenever the address in use
 * stops answering, so they move to the standby at once, without a reload or waiting for a rebuild.
 */
const serverManifest = (): Plugin => ({
  name: "server-manifest",
  generateBundle() {
    const servers = [process.env.VITE_API_URL, process.env.VITE_API_FALLBACK_URL].filter(Boolean);
    this.emitFile({ type: "asset", fileName: "server.json", source: JSON.stringify({ apiUrl: servers[0] ?? null, servers }) });
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
