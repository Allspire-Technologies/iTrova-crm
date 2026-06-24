import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare plugin boots the Workers runtime (workerd) for build/preview, which is
// a deployment concern and hangs CI under `vite preview`. It adds nothing to SPA testing,
// so skip it when E2E=true; real builds (`npm run build`, `npm run deploy`) keep it.
const plugins: PluginOption[] = [react()];
if (process.env.E2E !== "true") plugins.push(cloudflare());

export default defineConfig({
  // Served at the root of its own subdomain (itrova-crm.allspire.tech).
  server: { host: "::", port: 8090 },
  plugins,
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});