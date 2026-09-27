import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ./run.sh ot dev points the proxy at the OT server on :8766
  server: { port: 5173, proxy: { "/api": `http://127.0.0.1:${process.env.MCT_API_PORT ?? 8765}` } },
  build: { outDir: "dist", emptyOutDir: true },
});
