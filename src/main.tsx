import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);

// Register the PWA service worker in real browsers only. Skipped under automation
// (navigator.webdriver) so it can't intercept requests during e2e, and only in prod builds.
if (import.meta.env.PROD && "serviceWorker" in navigator && !navigator.webdriver) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-fatal: app works without the SW */
    });
  });
}
