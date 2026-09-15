import { safeDiagnostic } from "../utils/privacySafeLog.js";
import Consultation from "../models/Consultation.js";
import Notification from "../models/Notification.js";
import Patient from "../models/Patient.js";
import Token from "../models/Token.js";
import Appointment from "../models/Appointment.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import FollowUpPlan from "../models/FollowUpPlan.js";
import { currentTenantId } from "./tenantExecutionContext.js";
import { ensureFollowUpPlan, reconcileFollowUpPlan, followUpReminderStage,
  followUpReminderContent, calendarDatePlus } from "./followUpService.js";
import { hospitalLocalDateTime } from "../utils/clinicOperations.js";
import { sendPatientNotificationEmail } from "../utils/sendEmail.js";

const HOSPITAL_TIMEZONE =
  process.env.HOSPITAL_TIMEZONE || "Asia/Kolkata";

function hospitalDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function emitPatientNotification(io, patientId, notification) {
  if (!io || !patientId || !notification) return;

  io.to(`patient:${String(patientId)}`).emit("patient:notification", notification);
}

export async function createPatientNotification({
  patientId,
  type,
  title,
  message,
  metadata = {},
  dedupeKey,
  sendEmail = false,
  io = null,
}) {
  if (!patientId) return null;

  let notification = null;
  const notificationPatient = await Patient.findById(patientId)
    .select("tenantId privacyContactDisabled")
    .lean();

  if (!notificationPatient || notificationPatient.privacyContactDisabled) return null;

  try {
    notification = await Notification.create({
      tenantId: notificationPatient?.tenantId || null,
      patient: patientId,
      type,
      title,
      message,
      metadata,
      dedupeKey: dedupeKey || undefined,
    });
  } catch (error) {
    if (error?.code === 11000 && dedupeKey) {
      return Notification.findOne({ tenantId: notificationPatient?.tenantId || null, dedupeKey }).lean();
    }
    throw error;
  }

  const plainNotification = notification.toObject();
  emitPatientNotification(io, patientId, plainNotification);

  if (sendEmail) {
    try {
      const patient = await Patient.findById(patientId)
        .select("email privacyContactDisabled")
        .lean();

      if (patient?.email && !patient.privacyContactDisabled) {
        await sendPatientNotificationEmail(
          patient.email,
          title,
          message
        );

        notification.emailSentAt = new Date();
        await notification.save();
        plainNotification.emailSentAt = notification.emailSentAt;
      }
    } catch (error) {
      // Email failure must never break a clinical queue action.
      console.error("Patient notification email error:", safeDiagnostic(error));
    }
  }

  return plainNotification;
}

export async function processQueueNotifications(io) {
  try {
    const activeTokens = await Token.find({
      isArchived: { $ne: true },
      status: { $in: ["waiting", "called"] },
      "queueControl.isOnHold": { $ne: true },
      patient: { $ne: null },
    })
      .select(
        "_id patient tokenNumber department assignedDoctor status calledAt"
      )
      .lean();

    const waitingTokens = activeTokens.filter(
      (token) => token.status === "waiting"
    );

    for (const token of waitingTokens) {
      const doctorId = token.assignedDoctor
        ? String(token.assignedDoctor)
        : "";

      const patientsAhead = activeTokens.filter((item) => {
        if (item.status !== "waiting") return false;
        if (item.department !== token.department) return false;

        const itemDoctorId = item.assignedDoctor
          ? String(item.assignedDoctor)
          : "";

        if (doctorId && itemDoctorId !== doctorId) return false;

        return Number(item.tokenNumber) < Number(token.tokenNumber);
      }).length;

      let threshold = null;
      let title = "";
      let message = "";

      // Use threshold crossing ranges instead of exact equality. If the queue
      // jumps (for example 6 -> 4 or 3 -> 1), the patient still receives the
      // most relevant warning. Dedupe keys ensure each stage is sent once.
      if (patientsAhead === 0) {
        threshold = "next";
        title = "You are next";
        message =
          `Token #${token.tokenNumber}: you are next in line. Please be ready to enter when called.`;
      } else if (patientsAhead <= 2) {
        threshold = "2-ahead";
        title = `${patientsAhead} patient${patientsAhead === 1 ? "" : "s"} ahead`;
        message =
          `Token #${token.tokenNumber}: ${patientsAhead} patient${patientsAhead === 1 ? "" : "s"} ${patientsAhead === 1 ? "is" : "are"} ahead of you. Please remain near the clinic.`;
      } else if (patientsAhead <= 5) {
        threshold = "5-ahead";
        title = `${patientsAhead} patients ahead`;
        message =
          `Token #${token.tokenNumber}: ${patientsAhead} patients are ahead of you in ${token.department}. Please stay ready.`;
      }

      if (threshold) {
        await createPatientNotification({
          patientId: token.patient,
          type: `queue_${threshold.replace("-", "_")}`,
          title,
          message,
          metadata: {
            tokenId: token._id,
            tokenNumber: token.tokenNumber,
            department: token.department,
            patientsAhead,
          },
          dedupeKey: `token:${token._id}:queue:${threshold}`,
          sendEmail: false,
          io,
        });
      }
    }
  } catch (error) {
    console.error("Queue notification processing error:", safeDiagnostic(error));
  }
}

export async function notifyTokenCalled(token, io) {
  if (!token?.patient) return;

  await createPatientNotification({
    patientId: token.patient,
    type: "token_called",
    title: "Your token is being called",
    message:
      `Token #${token.tokenNumber} is now being called. Please proceed to the doctor's room.`,
    metadata: {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      department: token.department,
    },
    dedupeKey: `token:${token._id}:called`,
    sendEmail: false,
    io,
  });
}

export async function notifyNoShow(token, io) {
  if (!token?.patient) return;

  await createPatientNotification({
    patientId: token.patient,
    type: "no_show",
    title: "Missed queue turn",
    message:
      `Token #${token.tokenNumber} was marked as no-show. Please contact reception if you are still at the clinic.`,
    metadata: {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      department: token.department,
    },
    dedupeKey: `token:${token._id}:no-show`,
    sendEmail: true,
    io,
  });
}

export async function notifyConsultationCompleted(token, io) {
  if (!token?.patient) return;

  await createPatientNotification({
    patientId: token.patient,
    type: "consultation_completed",
    title: "Consultation completed",
    message:
      `Your consultation for token #${token.tokenNumber} has been marked completed. Your visit record is available in the patient portal.`,
    metadata: {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      department: token.department,
    },
    dedupeKey: `token:${token._id}:completed`,
    sendEmail: false,
    io,
  });
}

export async function notifyAppointmentBooked(appointment, io) {
  if (!appointment?.patient) return;

  await createPatientNotification({
    patientId: appointment.patient,
    type: "appointment_booked",
    title: "Appointment confirmed",
    message:
      `Your appointment with Dr. ${appointment.doctorName} is confirmed for ${appointment.appointmentDate} at ${appointment.startTime} (${appointment.department}).`,
    metadata: {
      appointmentId: appointment._id,
      doctorName: appointment.doctorName,
      department: appointment.department,
      appointmentDate: appointment.appointmentDate,
      startTime: appointment.startTime,
    },
    dedupeKey: `appointment:${appointment._id}:booked`,
    sendEmail: true,
    io,
  });
}

export async function notifyAppointmentCheckedIn(appointment, token, io) {
  if (!appointment?.patient || !token) return;

  await createPatientNotification({
    patientId: appointment.patient,
    type: "appointment_checked_in",
    title: "Check-in successful",
    message:
      `You are checked in for your appointment with Dr. ${appointment.doctorName}. Your live OPD token is #${token.tokenNumber}.`,
    metadata: {
      appointmentId: appointment._id,
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      department: appointment.department,
    },
    dedupeKey: `appointment:${appointment._id}:checked-in`,
    sendEmail: true,
    io,
  });
}

export async function processAppointmentReminders(io) {
  try {
    const now = hospitalDateParts();
    const appointments = await Appointment.find({
      appointmentDate: now.date,
      status: "booked",
    })
      .select(
        "_id patient doctorName department appointmentDate startTime"
      )
      .lean();

    for (const appointment of appointments) {
      const [hour, minute] = String(appointment.startTime)
        .split(":")
        .map(Number);

      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;

      const startMinutes = hour * 60 + minute;
      const minutesUntil = startMinutes - now.minutes;

      // Send once when the appointment is within 90 minutes. This is
      // intentionally wider than the old 45–65 minute window so a short
      // server restart does not silently miss the reminder. The dedupe key
      // prevents duplicate delivery on subsequent worker runs.
      if (minutesUntil < 0 || minutesUntil > 90) continue;

      await createPatientNotification({
        patientId: appointment.patient,
        type: "appointment_reminder",
        title: "Appointment reminder",
        message:
          `Reminder: your appointment with Dr. ${appointment.doctorName} is at ${appointment.startTime} today in ${appointment.department}. Please arrive a little early.`,
        metadata: {
          appointmentId: appointment._id,
          doctorName: appointment.doctorName,
          department: appointment.department,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
        },
        dedupeKey: `appointment:${appointment._id}:reminder-1h`,
        sendEmail: true,
        io,
      });
    }
  } catch (error) {
    console.error("Appointment reminder processing error:", safeDiagnostic(error));
  }
}

// The existing hourly tenant-scoped job is retained. Each calendar stage is
// persisted at most once, even after restarts or concurrent worker execution.
export async function processFollowUpReminders(io, now = new Date()) {
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Follow-up reminders require tenant context.");
  const tenant = await Tenant.findById(tenantId).select("name timezone settings.displayName").lean();
  if (!tenant) return { processed: 0, created: 0 };
  const today = hospitalLocalDateTime(tenant, now).date;
  const startDate = calendarDatePlus(today, -3);
  const endDate = calendarDatePlus(today, 3);

  // Include a full UTC day on each edge; the precise eligibility is evaluated
  // using the clinic's own calendar date, not the server's timezone.
  const start = new Date(`${calendarDatePlus(startDate, -2)}T00:00:00Z`);
  const end = new Date(`${calendarDatePlus(endDate, 2)}T23:59:59.999Z`);
  const sources = await Consultation.find({
    status: "completed", followUpDate: { $gte: start, $lte: end },
  }).select("_id patient doctor department followUpDate").lean();
  let failed = 0;
  for (const source of sources) {
    try { await ensureFollowUpPlan(source, tenant); }
    catch (error) { failed++; console.error("Follow-up plan initialization failed:", safeDiagnostic(error)); }
  }

  const plans = await FollowUpPlan.find({
    dueDate: { $gte: startDate, $lte: endDate },
    status: { $in: ["pending", "scheduled"] },
  }).select("_id consultation patient doctor doctorName department dueDate status appointment").lean();

  let created = 0;
  for (const plan of plans) {
    try {
      const current = await reconcileFollowUpPlan(plan);
      const stage = followUpReminderStage(current, today);
      if (stage === null) continue;

      const [doctor, patient] = await Promise.all([
        User.findById(current.doctor).select("name department doctorSchedule.roomNumber").lean(),
        Patient.findById(current.patient).select("_id").lean(),
      ]);
      if (!patient) continue;
      const appointment = current.appointment ? await Appointment.findById(current.appointment)
        .select("_id status appointmentDate startTime doctorName department").lean() : null;
      const doctorName = doctor?.name || current.doctorName || "";
      const clinicName = tenant.settings?.displayName || tenant.name;
      const roomNumber = String(doctor?.doctorSchedule?.roomNumber || "").trim();
      const content = followUpReminderContent({
        stage, doctorName: doctor?.name || current.doctorName || "", department: current.department,
        dueDate: current.dueDate, clinicName, appointment, roomNumber,
      });
      const type = stage > 0 ? "follow_up_pending" : "follow_up_reminder";
      const metadata = {
        consultationId: current.consultation,
        followUpPlanId: current._id,
        followUpDate: current.dueDate,
        doctorId: current.doctor,
        doctorName,
        roomNumber,
        department: current.department,
        clinicName,
        appointmentId: appointment?._id || null,
        appointmentDate: appointment?.appointmentDate || null,
        startTime: appointment?.startTime || null,
        stage,
      };
      // A new plan can have a new due date, but the source consultation is
      // immutable. The date + stage key protects every individual reminder.
      const key = `consultation:${current.consultation}:follow-up:${current.dueDate}:stage:${stage}`;
      const existing = await Notification.findOne({
        dedupeKey: { $in: stage === 0
          ? [key, `consultation:${current.consultation}:follow-up:${today}`]
          : [key] },
      }).select("_id").lean();
      if (existing) continue;
      // Do not queue a reminder for a plan that was completed in the meantime.
      const stillPending = await FollowUpPlan.findOne({
        _id: current._id, status: { $in: ["pending", "scheduled"] },
      }).select("_id").lean();
      if (!stillPending) continue;
      const notification = await createPatientNotification({
        patientId: current.patient, type, title: content.title, message: content.message,
        metadata, dedupeKey: key,
        // Preserve the pre-existing due-day email behavior. All new stages
        // are in-app only; no new mail or SMS costs are introduced.
        sendEmail: stage === 0, io,
      });
      if (notification) created++;
    } catch (error) {
      failed++;
      console.error("Follow-up reminder delivery failed:", safeDiagnostic(error));
    }
  }
  if (failed) console.warn(`Follow-up reminders: ${failed} item(s) failed; the next hourly run will retry.`);
  return { processed: plans.length, created, failed };
}
