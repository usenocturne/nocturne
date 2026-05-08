import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:20574",
      "/ws": { target: "ws://localhost:20574", ws: true },
    },
  },
});
