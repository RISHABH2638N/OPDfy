import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const production = command === "build";
  const api = env.VITE_API_URL || "";
  const socket = env.VITE_SOCKET_URL || (api ? new URL(api).origin : "");
  if (production && (!api || !socket || [api, socket].some((url) => {
    try { const value = new URL(url); return value.protocol !== "https:" || Boolean(value.username || value.password); }
    catch { return true; }
  }))) throw new Error("Set VITE_API_URL and VITE_SOCKET_URL to your HTTPS backend before building.");
  const allowed = production ? [...new Set([new URL(api).origin, new URL(socket).origin, new URL(socket).origin.replace(/^https:/, "wss:")])].join(" ") : "http: https: ws: wss:";
  const csp = `default-src 'self'; script-src 'self'${production ? "" : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ${allowed}; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:`;
  return {
    plugins: [react(), { name: "opd-content-security-policy", transformIndexHtml() {
      return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" }];
    } }],
    build: { sourcemap: false, rollupOptions: { output: { manualChunks(id) {
      if (id.includes("node_modules/html5-qrcode")) return "qr-scanner";
      if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return "react-vendor";
    } } } },
  };
});
