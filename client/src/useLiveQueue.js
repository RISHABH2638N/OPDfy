import { useCallback, useEffect, useRef, useState } from "react";
import { api, getSelectedClinicSlug } from "./api";
import { socket } from "./socket";

export function useLiveQueue(accessMode = "public") {
  const [clinic, setClinic] = useState(getSelectedClinicSlug);
  const [state, setState] = useState({ tokens: [], status: "loading", lastUpdated: null });
  const reload = useRef(() => {});
  const retry = useCallback(() => reload.current(), []);
  useEffect(() => {
    const sync = () => setClinic(getSelectedClinicSlug());
    window.addEventListener("opd:clinic-context", sync);
    return () => window.removeEventListener("opd:clinic-context", sync);
  }, []);
  useEffect(() => {
    let active = true, inFlight = false, pending = false, controller = null, received = false;
    let generation = 0;
    setState({ tokens: [], status: "loading", lastUpdated: null });
    const failed = () => { if (active) setState(current => ({ ...current, status: received ? "stale" : "error" })); };
    const accept = tokens => {
      if (!active) return;
      received = true;
      setState({ tokens, status: socket.connected ? "ready" : "stale", lastUpdated: new Date().toISOString() });
    };
    const fetchQueue = async () => {
      if (!active) return;
      if (inFlight) { pending = true; return; }
      inFlight = true; controller = new AbortController(); const started = generation;
      try {
        const path = accessMode === "staff" ? "/tokens/private" : accessMode === "patient" ? "/patients/me/tokens" : "/tokens";
        const response = await api.get(path, { signal: controller.signal });
        const tokens = accessMode === "patient" ? (response.data?.tokens || []).filter(item => item.isArchived !== true) : response.data;
        if (!Array.isArray(tokens)) throw new Error("Invalid queue response.");
        if (started === generation) accept(tokens);
      } catch (error) {
        if (error.code !== "ERR_CANCELED" && started === generation) failed();
      } finally {
        inFlight = false;
        if (active && pending) { pending = false; fetchQueue(); }
      }
    };
    reload.current = fetchQueue;
    const updated = data => {
      if (accessMode !== "public") { fetchQueue(); return; }
      if (!Array.isArray(data)) { failed(); return; }
      generation++; controller?.abort(); accept(data);
    };
    const patientUpdated = token => {
      if (accessMode !== "patient" || !token || !(token._id || token.id)) return;
      // A minimal token patch is not a complete authoritative queue snapshot.
      // Refetch/coalesce through the patient-only endpoint instead of treating a
      // stale partial update as proof that the whole queue is current.
      fetchQueue();
    };
    const disconnected = () => failed();
    fetchQueue();
    socket.on("queue:updated", updated); socket.on("patient:token-updated", patientUpdated);
    socket.on("connect", fetchQueue); socket.on("disconnect", disconnected); socket.on("connect_error", disconnected);
    return () => {
      active = false; controller?.abort(); reload.current = () => {};
      socket.off("queue:updated", updated); socket.off("patient:token-updated", patientUpdated);
      socket.off("connect", fetchQueue); socket.off("disconnect", disconnected); socket.off("connect_error", disconnected);
    };
  }, [accessMode, clinic]);
  return { ...state, retry };
}
