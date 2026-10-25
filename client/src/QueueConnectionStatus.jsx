import React from "react";
import { useLanguage } from "./LanguageContext";
export default function QueueConnectionStatus({ state }) {
  const { t } = useLanguage();
  if (state.status === "ready") return null;
  return <section className="queue-connection-status card" role="status" aria-live="polite">
    <strong>{t(state.status === "loading" ? "Loading queue..." : state.status === "stale" ? "Queue updates are delayed" : "Queue is unavailable")}</strong>
    <p>{t(state.status === "stale" ? "Showing the last successful queue snapshot. Refresh before acting on it." : state.status === "error" ? "The queue could not be loaded. This does not mean it is empty." : "Waiting for a current queue snapshot.")}</p>
    {state.lastUpdated && <small>{t("Last successful update")}: <time dateTime={state.lastUpdated}>{new Date(state.lastUpdated).toLocaleTimeString()}</time></small>}
    {state.status !== "loading" && <button type="button" className="ghost" onClick={state.retry}>{t("Retry queue refresh")}</button>}
  </section>;
}
