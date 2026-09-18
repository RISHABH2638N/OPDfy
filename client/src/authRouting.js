// Session identity is determined from the API route, never from whichever
// account happens to have a token in browser storage.
const PATIENT_PATHS = /^\/(?:patients(?:\/|$)|feedback\/patient(?:\/|$)|ai\/(?:chat|triage)(?:\/|$)|referrals\/patient(?:\/|$))/;
const PUBLIC_AUTH_PATHS = /^\/(?:auth\/(?:login|logout)|patient-auth\/(?:send-otp|verify-otp|refresh|forget-device|logout)|platform\/auth\/(?:login|logout))(?:\/|$)/;

export function sessionKindForRequest(url) {
  const path = String(url || "").split(/[?#]/, 1)[0];
  if (path === "/patient-auth" || path.startsWith("/patient-auth/") ||
      path === "/patient-platform" || path.startsWith("/patient-platform/")) return "patient";
  if (path.startsWith("/platform/") || path.startsWith("/privacy/admin/")) return "platform";
  if (path === "/privacy-clinic" || path.startsWith("/privacy-clinic/")) return "staff";
  if (path === "/privacy" || path.startsWith("/privacy/") ||
      path === "/patient-auth" || path.startsWith("/patient-auth/") ||
      path === "/patient-platform" || path.startsWith("/patient-platform/")) return "patient";
  if (PATIENT_PATHS.test(path)) return "patient";
  return "staff";
}

export function isSessionExpiryEligible(url) {
  const path = String(url || "").split(/[?#]/, 1)[0];
  return !PUBLIC_AUTH_PATHS.test(path) && !/\/(?:login|verify-otp|send-otp|logout)$/.test(path);
}

export function shouldExpireSession(error, currentToken) {
  if (error?.response?.status !== 401 || !isSessionExpiryEligible(error.config?.url)) return false;
  const sent = error.config?.headers?.Authorization;
  return Boolean(currentToken && sent === `Bearer ${currentToken}`);
}
