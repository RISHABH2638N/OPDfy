import { safeDiagnostic } from "../utils/privacySafeLog.js";
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

function isTransient(error) {
  return (
    TRANSIENT_CODES.has(error?.code) ||
    TRANSIENT_CODES.has(error?.cause?.code) ||
    error?.name === "MongoNetworkError" ||
    error?.name === "MongoServerSelectionError"
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createResilientJob(name, task, { retryDelayMs = 2000, onSuccess = null, onFailure = null } = {}) {
  let running = false;

  return async (...args) => {
    if (running) return;
    running = true;
    const startedAt = new Date();
    try {
      try {
        const result = await task(...args);
        if (onSuccess) { try { await onSuccess(startedAt); } catch (hookError) { console.warn(`${name} monitoring failed:`, safeDiagnostic(hookError)); } }
        return result;
      } catch (error) {
        if (!isTransient(error)) throw error;
        console.warn(`${name}: temporary database/network interruption; retrying once.`);
        await sleep(retryDelayMs);
        const result = await task(...args);
        if (onSuccess) { try { await onSuccess(startedAt); } catch (hookError) { console.warn(`${name} monitoring failed:`, safeDiagnostic(hookError)); } }
        return result;
      }
    } catch (error) {
      if (onFailure) { try { await onFailure(startedAt, error); } catch (hookError) { console.warn(`${name} monitoring failed:`, safeDiagnostic(hookError)); } }
      console.error(`${name} failed (${safeDiagnostic(error)}).`);
    } finally {
      running = false;
    }
  };
}
