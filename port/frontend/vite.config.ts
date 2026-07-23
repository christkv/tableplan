import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/mcp": "http://127.0.0.1:8080",
    },
  },
  build: {
    sourcemap: false,
    outDir: "dist",
  },
});
