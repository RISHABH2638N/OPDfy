// Navigation hint only. Authentication/refresh/authorization stay in api.js and the server.
export function getPatientToken() {
  try { return sessionStorage.getItem('opd_patient_token'); } catch { return null; }
}
