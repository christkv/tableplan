import { defineConfig } from "vitest/config";

const backend = "http://127.0.0.1:9090";
const oauthProxy = {
  target: backend,
  changeOrigin: false,
  xfwd: true,
};

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": backend,
      "/mcp": backend,
      "/oauth2": oauthProxy,
      "/login/oauth2": oauthProxy,
    },
  },
  build: {
    sourcemap: false,
    outDir: "dist",
  },
});
