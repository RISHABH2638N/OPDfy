import { safeDiagnostic } from "./utils/privacySafeLog.js";
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
import patientRoutes from "./routes/patientRoutes.js";
import consultationRoutes from "./routes/consultationRoutes.js";
import receptionRoutes from "./routes/receptionRoutes.js";
import checkInRoutes from "./routes/checkInRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import platformRoutes from "./routes/platformRoutes.js";
import displayRoutes from "./routes/displayRoutes.js";
import onboardingRoutes from "./routes/onboardingRoutes.js";
import Feedback from "./models/Feedback.js";
import Tenant from "./models/Tenant.js";
import { tenantContext } from "./middleware/tenantContext.js";
import { activityAuditMiddleware } from "./middleware/activityAudit.js";
import { ensureDefaultTenant } from "./services/tenantBootstrapService.js";
import { runWithTenant } from "./services/tenantExecutionContext.js";
import { resolvePatientMembership } from "./services/patientMembershipService.js";
import { expireDueSubscriptions } from "./services/subscriptionService.js";
import { createResilientJob } from "./services/resilientJob.js";
import { recoverInterruptedBackupJobs, runScheduledBackup } from "./services/backupRecoveryService.js";
import { recordMaintenanceRun } from "./services/operationalJobMonitor.js";
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


import { assertPrivacyRetentionIndexes } from "./services/privacyRetentionSafety.js";
import { createApplication } from "./app.js";
const { app, server, io } = createApplication();

const PORT = process.env.PORT || 5000;

mongoose.connection.on("disconnected", () => console.warn("MongoDB connection interrupted; driver will retry."));
mongoose.connection.on("reconnected", () => console.log("MongoDB connection restored."));
mongoose.connection.on("error", (error) =>
  console.warn(`MongoDB connection warning (${safeDiagnostic(error)})`)
);

(async () => {
  try {
    validateRuntimeEnv();

    await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: false,
      serverSelectionTimeoutMS: runtimeConfig.mongoServerSelectionTimeoutMs,
      connectTimeoutMS: runtimeConfig.mongoConnectTimeoutMs,
      socketTimeoutMS: runtimeConfig.mongoSocketTimeoutMs,
    });

    await assertPrivacyRetentionIndexes(mongoose.connection.db);

    if (!runtimeConfig.isProduction) {
      const defaultTenant = await ensureDefaultTenant();
      console.log(`Development tenant ready: ${defaultTenant.slug}`);
    }

    // Day 20 migration: convert any legacy plaintext waiting-lounge bearer keys
    // to hashed lookup + encrypted admin-recovery form without invalidating TV URLs.
    const legacyDisplays = await mongoose.connection.db.collection("waitingloungedisplays")
      .find({ accessKey: { $type: "string" }, accessKeyHash: { $exists: false } })
      .project({ _id: 1, accessKey: 1 })
      .toArray();
    for (const legacyDisplay of legacyDisplays) {
      const rawKey = String(legacyDisplay.accessKey || "");
      if (!/^[a-f0-9]{48}$/i.test(rawKey)) continue;
      await mongoose.connection.db.collection("waitingloungedisplays").updateOne(
        { _id: legacyDisplay._id },
        {
          $set: {
            accessKeyHash: hashDisplayKey(rawKey),
            accessKeyEncrypted: encryptDisplayKey(rawKey),
            accessKeyExpiresAt: new Date(Date.now() + Number(process.env.DISPLAY_KEY_TTL_DAYS || 90) * 86400000),
          },
          $unset: { accessKey: "" },
        }
      );
    }
    if (legacyDisplays.length) console.log(`Migrated ${legacyDisplays.length} waiting-lounge display credential(s).`);

    const runTenantMaintenance = async (tenantId) => runWithTenant(tenantId, async () => {
      await Patient.updateMany({ email: { $in: ["", null] } }, { $unset: { email: "" } });
      await Patient.updateMany({ phone: { $in: ["", null] } }, { $unset: { phone: "" } });
      await Token.updateMany({ isArchived: { $exists: false } }, { $set: { isArchived: false } });
      await Token.updateMany({ arrivalStatus: { $exists: false } }, { $set: { arrivalStatus: "not_checked_in" } });
      return reconcileLinkedAppointmentStatuses();
    });

    for (const model of Object.values(mongoose.models)) await model.createIndexes();
    await recoverInterruptedBackupJobs();

    const expiredAtStartup = await expireDueSubscriptions();
    if (expiredAtStartup > 0) console.log(`Expired ${expiredAtStartup} due clinic subscription(s).`);

    const activeTenants = await Tenant.find({ status: "active" }).select("_id slug").lean();
    for (const tenant of activeTenants) {
      const reconciledAppointments = await runTenantMaintenance(tenant._id);
      if (reconciledAppointments > 0) {
        console.log(`Reconciled ${reconciledAppointments} appointment status record(s) for ${tenant.slug}.`);
      }
      await runWithTenant(tenant._id, () => processAppointmentReminders(io));
      await runWithTenant(tenant._id, () => processFollowUpReminders(io));
    }

    const runForEveryActiveTenant = async (task) => {
      const tenants = await Tenant.find({ status: "active" }).select("_id").lean();
      for (const tenant of tenants) {
        await runWithTenant(tenant._id, () => task(io));
      }
    };

    const appointmentReminderJob = createResilientJob(
      "Appointment reminder job",
      () => runForEveryActiveTenant(processAppointmentReminders),
      { onSuccess: started => recordMaintenanceRun("appointment_reminders", "success", started), onFailure: (started, error) => recordMaintenanceRun("appointment_reminders", "failure", started, error) }
    );
    const followUpReminderJob = createResilientJob(
      "Follow-up reminder job",
      () => runForEveryActiveTenant(processFollowUpReminders),
      { onSuccess: started => recordMaintenanceRun("followup_reminders", "success", started), onFailure: (started, error) => recordMaintenanceRun("followup_reminders", "failure", started, error) }
    );
    const subscriptionExpiryJob = createResilientJob(
      "Subscription expiry job",
      expireDueSubscriptions,
      { onSuccess: started => recordMaintenanceRun("subscription_expiry", "success", started), onFailure: (started, error) => recordMaintenanceRun("subscription_expiry", "failure", started, error) }
    );
    const missedAppointmentJob = createResilientJob(
      "Missed appointment job",
      () => runForEveryActiveTenant(() => markMissedAppointments()),
      { onSuccess: started => recordMaintenanceRun("missed_appointments", "success", started), onFailure: (started, error) => recordMaintenanceRun("missed_appointments", "failure", started, error) }
    );

    const maintenanceTimers = [
      setInterval(appointmentReminderJob, 60 * 1000),
      setInterval(followUpReminderJob, 60 * 60 * 1000),
      setInterval(subscriptionExpiryJob, 15 * 60 * 1000),
      setInterval(missedAppointmentJob, 5 * 60 * 1000),
      setInterval(() => runScheduledBackup().catch(error => console.error(`Scheduled backup check failed (${error?.code || error?.name || "ERROR"}).`)), 15 * 60 * 1000),
    ];
    setTimeout(() => runScheduledBackup().catch(error => console.error(`Scheduled backup startup check failed (${error?.code || error?.name || "ERROR"}).`)), 5000).unref?.();
    maintenanceTimers.forEach((timer) => timer.unref?.());

    console.log("MongoDB connected and indexes synchronized");
    server.listen(PORT, () =>
      console.log(`OPD server running at http://localhost:${PORT}`)
    );

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received. Shutting down cleanly...`);
      maintenanceTimers.forEach(clearInterval);
      io.disconnectSockets(true);
      server.close(async () => {
        try {
          await mongoose.connection.close();
        } finally {
          process.exit(0);
        }
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Startup error:", safeDiagnostic(error));
    process.exit(1);
  }
})();
