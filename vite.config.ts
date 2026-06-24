import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // Served under /admin on the same subdomain as iTrova (e.g. app.itrova.com/admin).
  base: "/admin/",
  server: { host: "::", port: 8090 },
  plugins: [react(), cloudflare()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});