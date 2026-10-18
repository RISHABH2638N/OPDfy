import { performance } from "node:perf_hooks";
import { databaseTransaction } from "../utils/databaseTransaction.js";
import { submitKeyedBatch } from "../utils/keyedAsyncBatch.js";
import { planBatch } from "../utils/planOnlineReservationBatch.js";
import { onlineReservationLimit } from "../utils/onlineReservationPolicy.js";
import QueueReservation from "../models/QueueReservation.js";
import User from "../models/User.js";

function conflict(message, code = "ONLINE_RESERVATION_LIMIT") {
  return Object.assign(new Error(message), { status: 409, code });
}


function doctorDateIsCurrent(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return date === `${get("year")}-${get("month")}-${get("day")}`;
}

/** One doctor write + one active-count + one insertMany per entire batch. */
async function commitBatch(entries) {
  const { tenantId, doctor, date, timezone } = entries[0];
  if (!doctorDateIsCurrent(date, timezone)) {
    return entries.map(() => ({ error: conflict("This booking date has ended. Please refresh and try again.", "DATE_CHANGED") }));
  }
  const attempt = { attempts: 0, countMs: 0, transactionMs: 0, batchSize: entries.length };
  const started = performance.now();
  try {
    const outcomes = await databaseTransaction(async () => {
      attempt.attempts++;
      const capacityDoctor = await User.findOneAndUpdate(
        { _id: doctor._id, role: "doctor" },
        { $inc: { reservationCapacityRevision: 1 } },
        { new: true }
      ).select("name onlineReservationLimit");
      if (!capacityDoctor) throw conflict("Doctor is no longer registered with this clinic.", "DOCTOR_UNAVAILABLE");
      const countStarted = performance.now();
      const used = await QueueReservation.countDocuments({
        doctor: doctor._id, reservationDate: date,
        status: { $in: ["reserved", "checked_in"] },
      });
      attempt.countMs += performance.now() - countStarted;
      const alreadyReserved = await QueueReservation.find({
        patient: { $in: entries.map((entry) => entry.patient._id) },
        reservationDate: date, status: "reserved",
      }).select("patient").lean();
      const { outcomes: result, selected } = planBatch({
        entries, alreadyReserved, used,
        limit: onlineReservationLimit(capacityDoctor), doctorName: capacityDoctor.name,
      });
      if (selected.length) {
        const docs = selected.map((i) => {
          const entry = entries[i];
          return {
            tenantId, patient: entry.patient._id,
            patientId: entry.patient.patientId,
            patientName: entry.patient.name,
            phone: entry.patient.phone || "",
            department: entry.department, doctor: doctor._id,
            doctorName: capacityDoctor.name,
            urgency: entry.urgency === "emergency" ? "emergency" : "normal",
            patientRequestedUrgency: entry.patientRequestedUrgency === "emergency" ? "emergency" : "",
            reservationDate: date, status: "reserved",
            billing: { feeType: entry.feeQuote.feeType, quotedAmount: entry.feeQuote.amount, status: "pending" },
          };
        });
        const inserted = await QueueReservation.insertMany(docs, { ordered: true });
        inserted.forEach((doc, index) => { result[selected[index]] = { value: doc }; });
      }
      return result;
    });
    attempt.transactionMs = performance.now() - started;
    return outcomes.map((outcome) => ({ ...outcome, meta: attempt }));
  } catch (error) {
    // A unique-patient race on another server may invalidate one item in a
    // batch. Split ONLY for duplicate-key conflicts, so unrelated patients
    // can still book. All split operations stay inside the local keyed queue.
    if ((error?.code === "VISIT_CONFLICT" || error?.code === 11000) && entries.length > 1) {
      const half = Math.ceil(entries.length / 2);
      const first = await commitBatch(entries.slice(0, half));
      const second = await commitBatch(entries.slice(half));
      return [...first, ...second];
    }
    if (error?.code === "VISIT_CONFLICT" || error?.code === 11000) {
      return [{ error: conflict("You may already have a reservation today. Refresh your bookings before retrying.", "ALREADY_RESERVED"), meta: attempt }];
    }
    return entries.map(() => ({ error, meta: attempt }));
  }
}

export async function reserveOnlineQueueInBatch({ tenantId, patient, doctor, department,
  urgency, patientRequestedUrgency, date, timezone, feeQuote, signal, startedAt }) {
  const entry = { tenantId, patient, doctor, department, urgency,
    patientRequestedUrgency, date, timezone, feeQuote };
  const key = `${tenantId}:${doctor._id}:${date}`;
  const trace = process.env.PERF_TRACE_CLINICS === "1";
  return submitKeyedBatch(key, entry, commitBatch, {
    signal,
    onSettled: trace ? ({ waitMs, batchSize, outcome }) => {
      const meta = outcome?.meta || {};
      const transaction = meta.transactionMs || 0;
      const count = meta.countMs || 0;
      console.info(`[ClinicPerf] online_booking_phase2 total=${(performance.now() - startedAt).toFixed(1)}ms queue_wait=${waitMs.toFixed(1)}ms transaction=${transaction.toFixed(1)}ms count=${count.toFixed(1)}ms attempts=${meta.attempts ?? 0} batch_size=${batchSize} outcome=${outcome?.error ? "failure" : "success"}`);
    } : undefined,
  });
}
