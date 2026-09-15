import { io } from "socket.io-client";

const clinicSlug = String(
  sessionStorage.getItem("opd_active_clinic_slug") ||
  import.meta.env.VITE_CLINIC_SLUG ||
  (import.meta.env.DEV ? "demo-clinic" : "")
).trim().toLowerCase();

const browserHost = typeof window !== "undefined" ? window.location.hostname : "localhost";

export const socket = io(
  import.meta.env.VITE_SOCKET_URL || (import.meta.env.VITE_API_URL ? new URL(import.meta.env.VITE_API_URL, window.location.origin).origin : "") || (import.meta.env.PROD ? window.location.origin : `http://${browserHost}:5000`),
  {
    autoConnect: Boolean(clinicSlug),
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    auth: {
      clinicSlug,
      staffToken: sessionStorage.getItem("opd_token") || "",
      patientToken: sessionStorage.getItem("opd_patient_token") || "",
    },
  },
);
