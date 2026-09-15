import { sessionKindForRequest, shouldExpireSession } from "./authRouting.js";
import axios from "axios";
import { socket } from "./socket";

const browserHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
const defaultApiBase = import.meta.env.PROD ? "/api" : `http://${browserHost}:5000/api`;

/* =========================================================
   AXIOS INSTANCE
========================================================= */

export const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    defaultApiBase,
});



/* =========================================================
   PLATFORM SUPER ADMIN AUTHENTICATION
========================================================= */

export const platformApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiBase,
});

export const onboardingApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiBase,
});

export const patientPlatformApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiBase,
});

// Logout must use the captured credential even after local session storage is cleared.
// A separate client prevents asynchronous interceptors from replacing/removing it.
const revocationApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultApiBase,
  timeout: 20000,
});

const ONBOARDING_TOKEN_KEY = "opd_clinic_onboarding_token";

export function saveOnboardingToken(token) {
  if (token) sessionStorage.setItem(ONBOARDING_TOKEN_KEY, token);
}
export function getOnboardingToken() {
  return sessionStorage.getItem(ONBOARDING_TOKEN_KEY);
}
export function clearOnboardingToken() {
  sessionStorage.removeItem(ONBOARDING_TOKEN_KEY);
}
onboardingApi.interceptors.request.use((config) => {
  const token = getOnboardingToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const PLATFORM_TOKEN_KEY = "opd_platform_token";
const PLATFORM_USER_KEY = "opd_platform_user";

export function savePlatformAuth(data) {
  if (data?.token) sessionStorage.setItem(PLATFORM_TOKEN_KEY, data.token);
  if (data?.user) sessionStorage.setItem(PLATFORM_USER_KEY, JSON.stringify(data.user));
}

export function getStoredPlatformUser() {
  try {
    const value = sessionStorage.getItem(PLATFORM_USER_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function logoutPlatform() {
  const token = sessionStorage.getItem(PLATFORM_TOKEN_KEY);
  if (token) revocationApi.post("/platform/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  sessionStorage.removeItem(PLATFORM_TOKEN_KEY);
  sessionStorage.removeItem(PLATFORM_USER_KEY);
}

platformApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(PLATFORM_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});


const ACTIVE_CLINIC_SLUG_KEY = "opd_active_clinic_slug";

export function getSelectedClinicSlug() {
  return String(sessionStorage.getItem(ACTIVE_CLINIC_SLUG_KEY) || "").trim().toLowerCase();
}

export function getActiveClinicSlug() {
  return String(
    getSelectedClinicSlug() ||
    import.meta.env.VITE_CLINIC_SLUG ||
    (import.meta.env.DEV ? "demo-clinic" : "")
  ).trim().toLowerCase();
}

function notifyClinicContextChanged(slug = "") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("opd:clinic-context", { detail: { slug } }));
  }
}

export function clearActiveClinicSlug() {
  sessionStorage.removeItem(ACTIVE_CLINIC_SLUG_KEY);
  socket.auth = { ...(socket.auth || {}) };
  delete socket.auth.clinicSlug;
  socket.disconnect();
  notifyClinicContextChanged("");
}

export function setActiveClinicSlug(slug) {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) return;
  sessionStorage.setItem(ACTIVE_CLINIC_SLUG_KEY, normalized);

  // Keep real-time tenant room aligned with the HTTP tenant header.
  socket.auth = { ...(socket.auth || {}), clinicSlug: normalized };
  notifyClinicContextChanged(normalized);
  if (socket.connected) socket.disconnect();
  socket.connect();
}

/* =========================================================
   STAFF AUTHENTICATION
========================================================= */

const STAFF_TOKEN_KEY = "opd_token";
const STAFF_USER_KEY = "opd_user";

export function getStoredUser() {
  try {
    const storedUser =
      sessionStorage.getItem(STAFF_USER_KEY);

    return storedUser
      ? JSON.parse(storedUser)
      : null;
  } catch {
    return null;
  }
}

export const user = getStoredUser;

export function saveAuth(data) {
  sessionStorage.removeItem("opd_patient_token");
  sessionStorage.removeItem("opd_patient_user");
  if (data?.token) {
    sessionStorage.setItem(STAFF_TOKEN_KEY, data.token);
    socket.auth = { ...(socket.auth || {}), staffToken: data.token, patientToken: "" };
    if (socket.connected) socket.disconnect();
    socket.connect();
  }

  if (data?.user) {
    sessionStorage.setItem(
      STAFF_USER_KEY,
      JSON.stringify(data.user)
    );
  }
}

export function logout() {
  const token = sessionStorage.getItem(STAFF_TOKEN_KEY);
  if (token) revocationApi.post("/auth/logout", {}, { headers: { Authorization: `Bearer ${token}`, "X-Clinic-Slug": getActiveClinicSlug() } }).catch(() => {});
  sessionStorage.removeItem(STAFF_TOKEN_KEY);
  socket.auth = { ...(socket.auth || {}), staffToken: "" };
  if (socket.connected) socket.disconnect();
  socket.connect();
  sessionStorage.removeItem(STAFF_USER_KEY);
}


/* =========================================================
   PATIENT AUTHENTICATION
========================================================= */

const PATIENT_TOKEN_KEY =
  "opd_patient_token";

const PATIENT_USER_KEY =
  "opd_patient_user";

export function savePatientAuth(data) {
  sessionStorage.removeItem("opd_token");
  sessionStorage.removeItem("opd_user");
  clearActiveClinicSlug();
  if (data?.token) {
    sessionStorage.setItem(PATIENT_TOKEN_KEY, data.token);
    socket.auth = { ...(socket.auth || {}), patientToken: data.token, staffToken: "" };
    if (socket.connected) socket.disconnect();
    if (getSelectedClinicSlug()) socket.connect();
  }

  if (data?.patient) {
    sessionStorage.setItem(
      PATIENT_USER_KEY,
      JSON.stringify(data.patient)
    );
  }
}

export function updateStoredPatient(patient) {
  if (!patient) return;

  sessionStorage.setItem(
    PATIENT_USER_KEY,
    JSON.stringify(patient)
  );
}

export function getPatientToken() {
  return sessionStorage.getItem(
    PATIENT_TOKEN_KEY
  );
}

export function getStoredPatient() {
  try {
    const patient =
      sessionStorage.getItem(
        PATIENT_USER_KEY
      );

    return patient
      ? JSON.parse(patient)
      : null;
  } catch {
    return null;
  }
}

export function logoutPatient() {
  const token = sessionStorage.getItem(PATIENT_TOKEN_KEY);
  if (token) revocationApi.post("/patient-auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  socket.emit("patient:logout");

  sessionStorage.removeItem(PATIENT_TOKEN_KEY);
  socket.auth = { ...(socket.auth || {}), patientToken: "" };

  sessionStorage.removeItem(
    PATIENT_USER_KEY
  );

  // A global patient account must not leak the previous clinic into the next login.
  clearActiveClinicSlug();
}

patientPlatformApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(PATIENT_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});


/* =========================================================
   GENERAL REQUEST INTERCEPTOR
========================================================= */

api.interceptors.request.use((config) => {
  config.headers["X-Clinic-Slug"] = getActiveClinicSlug();
  const kind = sessionKindForRequest(config.url);
  const token = kind === "patient" ? getPatientToken() :
    kind === "platform" ? sessionStorage.getItem(PLATFORM_TOKEN_KEY) :
    sessionStorage.getItem(STAFF_TOKEN_KEY);

  // Do not send an unrelated staff credential to patient-only routes.
  // Remove any stale Authorization header when no matching session exists.
  if (token) config.headers.Authorization = `Bearer ${token}`;
  else delete config.headers.Authorization;
  return config;
}, (error) => Promise.reject(error));

// Expired sessions return to the appropriate sign-in page. Failed login attempts
// stay on their form; no token or medical data is written to persistent storage.
function expireLocalSession(kind) {
  const key = kind === "patient" ? PATIENT_TOKEN_KEY :
    kind === "platform" ? PLATFORM_TOKEN_KEY : STAFF_TOKEN_KEY;
  const currentToken = sessionStorage.getItem(key);
  if (!currentToken) return;

  const keys = kind === "patient" ? [PATIENT_TOKEN_KEY, PATIENT_USER_KEY] :
    kind === "platform" ? [PLATFORM_TOKEN_KEY, PLATFORM_USER_KEY] : [STAFF_TOKEN_KEY, STAFF_USER_KEY];
  keys.forEach((item) => sessionStorage.removeItem(item));
  if (kind === "patient") {
    clearActiveClinicSlug();
    socket.auth = { ...(socket.auth || {}), patientToken: "" };
  } else if (kind === "staff") {
    socket.auth = { ...(socket.auth || {}), staffToken: "" };
    socket.disconnect();
  }
  window.dispatchEvent(new CustomEvent("opd:session-expired", { detail: { kind } }));
}

for (const [client, kind] of [[platformApi, "platform"], [patientPlatformApi, "patient"], [api, null]]) {
  client.defaults.timeout = 20000;
  client.interceptors.response.use((response) => response, (error) => {
    const identity = kind || sessionKindForRequest(error.config?.url);
    const token = identity === "patient" ? getPatientToken() :
      identity === "platform" ? sessionStorage.getItem(PLATFORM_TOKEN_KEY) :
      sessionStorage.getItem(STAFF_TOKEN_KEY);
    // A 401 is meaningful only for the identity and exact token sent.
    // Old requests must not sign out a newly authenticated session.
    if (shouldExpireSession(error, token)) expireLocalSession(identity);
    return Promise.reject(error);
  });
}
onboardingApi.defaults.timeout = 20000;
socket.on("session:expired", ({ kind } = {}) => {
  if (["patient", "staff", "platform"].includes(kind)) expireLocalSession(kind);
});
