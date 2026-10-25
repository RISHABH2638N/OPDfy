import rateLimit from "express-rate-limit";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";
import { logSecurityEvent } from "../utils/securityEvents.js";
import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { beginOwnerEnrollment, enableOwnerMfa, finishOwnerChallenge, changeOwnerMfa,
  decodeOwnerChallenge, mfaConfigured } from "../services/platformMfa.js";
const router = asyncRouter();
const ipLimiter = rateLimit({ windowMs: 15 * 60000, max: 30, store: createRateLimitStore("owner-mfa-ip"), standardHeaders: true, legacyHeaders: false });
const accountLimiter = rateLimit({ windowMs: 15 * 60000, max: 10, store: createRateLimitStore("owner-mfa-account"),
  keyGenerator: req => String(req.superAdmin?.id || req.mfaChallenge?.id || req.ip), standardHeaders: true, legacyHeaders: false });
function run(event, work) {
  return async (req, res) => {
    try {
      const data = await work(req);
      logSecurityEvent(req, { event, outcome: "success", actorType: "superadmin", actorId: req.superAdmin?.id || req.mfaChallenge?.id });
      return res.json(data);
    } catch (error) {
      logSecurityEvent(req, { event, outcome: "failure", actorType: req.superAdmin || req.mfaChallenge ? "superadmin" : "anonymous", actorId: req.superAdmin?.id || req.mfaChallenge?.id });
      if (!error.status) console.warn("Owner MFA operation failed:", safeDiagnostic(error));
      return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to complete MFA operation.") });
    }
  };
}
router.post("/auth/mfa/verify", ipLimiter, (req, res, next) => {
  try { req.mfaChallenge = decodeOwnerChallenge(req.body?.challengeToken); next(); }
  catch { res.status(401).json({ message: "Invalid or expired verification." }); }
}, accountLimiter, run("platform_mfa_login", req => finishOwnerChallenge(req.body?.challengeToken, req.body?.code)));
router.get("/auth/mfa/status", protectSuperAdmin, (req, res) => res.json({ enabled: req.superAdmin.mfaEnabled, configured: mfaConfigured(), enrollmentRequired: req.superAdmin.mfaEnrollmentRequired }));
router.post("/auth/mfa/enroll", ipLimiter, protectSuperAdmin, accountLimiter, run("platform_mfa_enrollment_started", req => beginOwnerEnrollment(req.superAdmin.id, req.body?.password)));
router.post("/auth/mfa/enable", ipLimiter, protectSuperAdmin, accountLimiter, run("platform_mfa_enabled", req => enableOwnerMfa(req.superAdmin.id, req.body?.password, req.body?.code)));
router.post("/auth/mfa/disable", ipLimiter, protectSuperAdmin, accountLimiter, run("platform_mfa_disabled", req => changeOwnerMfa(req.superAdmin.id, req.body?.password, req.body?.code)));
router.post("/auth/mfa/recovery-codes", ipLimiter, protectSuperAdmin, accountLimiter, run("platform_mfa_recovery_regenerated", req => changeOwnerMfa(req.superAdmin.id, req.body?.password, req.body?.code, true)));
export default router;
