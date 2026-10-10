import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
