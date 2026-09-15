import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import http from "http";
import { Server } from "socket.io";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";

import authRoutes from "./routes/authRoutes.js";
import tokenRoutes from "./routes/tokenRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import patientAuthRoutes from "./routes/patientAuthRoutes.js";
import patientPlatformRoutes from "./routes/patientPlatformRoutes.js";
import privacyRoutes from "./routes/privacyRoutes.js";
import privacyExtendedRoutes from "./routes/privacyExtendedRoutes.js";
import privacyClinicRoutes from "./routes/privacyClinicRoutes.js";
import privacyPhase3Routes from "./routes/privacyPhase3Routes.js";
import privacyPhase4Routes from "./routes/privacyPhase4Routes.js";
import backupRecoveryRoutes from "./routes/backupRecoveryRoutes.js";
import privacyClinicPhase3Routes from "./routes/privacyClinicPhase3Routes.js";
import patientRoutes from "./routes/patientRoutes.js";
import consultationRoutes from "./routes/consultationRoutes.js";
import departmentReferralRoutes from "./routes/departmentReferralRoutes.js";
import "./models/FollowUpPlan.js";
import receptionRoutes from "./routes/receptionRoutes.js";
import checkInRoutes from "./routes/checkInRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import platformRoutes from "./routes/platformRoutes.js";
import displayRoutes from "./routes/displayRoutes.js";
import onboardingRoutes from "./routes/onboardingRoutes.js";
import clinicalConsentRoutes from "./routes/clinicalConsentRoutes.js";
import Feedback from "./models/Feedback.js";
import Tenant from "./models/Tenant.js";
import { tenantContext } from "./middleware/tenantContext.js";
import { activityAuditMiddleware } from "./middleware/activityAudit.js";
import { ensureDefaultTenant } from "./services/tenantBootstrapService.js";
import { runWithTenant } from "./services/tenantExecutionContext.js";
import { resolvePatientMembership } from "./services/patientMembershipService.js";
import { expireDueSubscriptions } from "./services/subscriptionService.js";
import { createResilientJob } from "./services/resilientJob.js";
import { runtimeConfig, validateRuntimeEnv } from "./utils/runtimeConfig.js";
import { hashDisplayKey, encryptDisplayKey } from "./utils/displayKeyCrypto.js";
import { createRateLimitStore } from "./utils/rateLimitStore.js";

import Token from "./models/Token.js";
import Patient from "./models/Patient.js";
import User from "./models/User.js";
import GlobalPatient from "./models/GlobalPatient.js";
import GlobalPatientOtp from "./models/GlobalPatientOtp.js";
import Appointment from "./models/Appointment.js";
import QueueReservation from "./models/QueueReservation.js";
import Notification from "./models/Notification.js";
import WaitingLoungeDisplay from "./models/WaitingLoungeDisplay.js";
import SecurityEvent from "./models/SecurityEvent.js";
import {
  processAppointmentReminders,
  processFollowUpReminders,
} from "./services/notificationService.js";
import { reconcileLinkedAppointmentStatuses, markMissedAppointments } from "./services/appointmentLifecycleService.js";


import { installRealtimeGateway } from "./services/realtimeGateway.js";
import { requestSafety } from "./middleware/requestSafety.js";
import { sensitiveAccessAudit } from "./middleware/sensitiveAccessAudit.js";
import { publicErrorMessage } from "./utils/httpSafety.js";
import { safeDiagnostic } from "./utils/privacySafeLog.js";

export function createApplication() {
const app = express();
const server = http.createServer(app);
const client = process.env.CLIENT_URL || "http://localhost:5173";

app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));

// Browser/server hardening. CSP is kept compatible with the separate Vite
// frontend; API responses should never be framed or MIME-sniffed.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);

const allowedOrigins = client
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients (curl, server-to-server health checks) have no Origin.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    const error = new Error("Origin not allowed");
    error.status = 403;
    error.code = "CORS_ORIGIN_DENIED";
    return callback(error);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Clinic-Slug"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use("/api", requestSafety);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: runtimeConfig.apiRateMax,
    store: createRateLimitStore("api-global"),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const io = new Server(server, {
  maxHttpBufferSize: 16384,
  allowRequest: (req, callback) => callback(null, !req.headers.origin || allowedOrigins.includes(req.headers.origin)),
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true,
  },
});

app.set("io", io);

installRealtimeGateway(io);

function healthPayload() {
  const dbState = mongoose.connection.readyState;
  return {
    ok: dbState === 1,
    service: "opd-smart-queue",
    database: dbState === 1 ? "connected" : "unavailable",
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

app.get("/health", (req, res) => {
  const payload = healthPayload();
  res.status(payload.ok ? 200 : 503).json(payload);
});
app.get("/health/live", (req, res) =>
  res.json({ ok: true, service: "opd-smart-queue", uptimeSeconds: Math.floor(process.uptime()) })
);
app.get("/health/ready", (req, res) => {
  const payload = healthPayload();
  res.status(payload.ok ? 200 : 503).json(payload);
});

// Platform owner APIs are intentionally outside clinic tenantContext.
// They use a separate Super Admin identity and never expose clinical records.
app.use("/api/platform", platformRoutes);

// Clinic self-registration is public and creates its own server-resolved tenant.
app.use("/api/onboarding", onboardingRoutes);

// One patient account spans every clinic. Auth and discovery therefore live
// outside clinic tenantContext; clinical operations remain tenant-scoped below.
app.use("/api/patient-auth", patientAuthRoutes);
app.use("/api/patient-platform", patientPlatformRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/api/privacy", privacyExtendedRoutes);
app.use("/api/privacy", privacyPhase3Routes);
app.use("/api/privacy/admin/operations", privacyPhase4Routes);
app.use("/api/platform/backup-recovery", backupRecoveryRoutes);

// Secure clinic-specific TV display links resolve their tenant from the display key.
app.use("/api/display", displayRoutes);

app.use("/api", tenantContext);
app.use("/api", activityAuditMiddleware);
app.use("/api", sensitiveAccessAudit);

app.get("/api/tenant/current", (req, res) => {
  res.json({
    tenant: {
      id: String(req.tenant._id),
      name: req.tenant.name,
      slug: req.tenant.slug,
      status: req.tenant.status,
      timezone: req.tenant.timezone,
      contactEmail: req.tenant.contactEmail || "",
      contactPhone: req.tenant.contactPhone || "",
      settings: {
        displayName: req.tenant.settings?.displayName || req.tenant.name,
        defaultDepartment: req.tenant.settings?.defaultDepartment,
        branding: req.tenant.settings?.branding || {},
        prescriptionTemplate: req.tenant.settings?.prescriptionTemplate || {},
      },
    },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/tokens", tokenRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/privacy-clinic", privacyClinicRoutes);
app.use("/api/privacy-clinic", privacyClinicPhase3Routes);
app.use("/api/reception", receptionRoutes);
app.use("/api/check-in", checkInRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/consultations", consultationRoutes);
app.use("/api/referrals", departmentReferralRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/clinical-consents", clinicalConsentRoutes);

app.use((req, res) => res.status(404).json({ message: "Endpoint not found." }));

// Never expose Express stack traces, local filesystem paths, dependency paths,
// or raw internal errors to API clients. Expected HTTP errors retain their
// status and a safe message; unexpected errors become a generic 500 response.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;

  if (safeStatus >= 500) {
    if (runtimeConfig.isProduction) {
      console.error(`Unhandled request error (${safeDiagnostic(error)}).`);
    } else {
      console.error("Unhandled request error:", error);
    }
  }

  const message = error?.type === "entity.parse.failed" ? "Invalid JSON request." :
    error?.type === "entity.too.large" ? "Request is too large." :
    publicErrorMessage(error, "Internal server error.");

  return res.status(safeStatus).json({ message });
});


return { app, server, io };
}
