import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and no env leaking: only VITE_* public values are exposed.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_"],
  build: { target: "es2022", sourcemap: false, outDir: "dist", chunkSizeWarningLimit: 2000 },
});
