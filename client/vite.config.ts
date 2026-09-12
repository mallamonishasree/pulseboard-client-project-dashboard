import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true
      }
    }
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  }
});
