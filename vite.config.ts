import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    // The application only uses MongoDB's types and Better Auth only needs
    // ObjectId/UUID at runtime. Keep the network driver in the gateway Worker;
    // using BSON here prevents its Node connection-string stack from entering
    // Vite's Cloudflare runner (where `tr46` calls `require("punycode/")`).
    alias: [{ find: /^mongodb$/, replacement: "bson" }],
    tsconfigPaths: true,
  },
});
