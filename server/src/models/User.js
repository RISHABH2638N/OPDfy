import mongoose from "mongoose";
import { normalizeDepartment } from "../utils/departments.js";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
    passwordReset: {
      type: new mongoose.Schema({
        hash: String, nonce: String, email: String, version: Number,
        expiresAt: Date, sentAt: Date, attempts: Number,
      }, { _id: false }),
      select: false,
    },
    role: {
      type: String,
      enum: ["doctor", "admin", "receptionist"],
      default: "doctor",
    },
    department: {
      type: String,
      default: "General OPD",
      set: normalizeDepartment,
      index: true,
    },

    /* -------------------------------------------------------
       Doctor availability configured by Hospital Admin.
       Times are stored as local HH:mm strings because they
       represent the hospital's recurring OPD timetable.
    ------------------------------------------------------- */
    prescriptionProfile: {
      qualification: { type: String, default: "", trim: true, maxlength: 120 },
      specialization: { type: String, default: "", trim: true, maxlength: 120 },
      registrationNumber: { type: String, default: "", trim: true, maxlength: 80 },
      designation: { type: String, default: "", trim: true, maxlength: 120 },
      signatureDataUrl: { type: String, default: "", trim: true, maxlength: 220000 },
    },
    professionalVerification: {
      type: new mongoose.Schema({
        councilName: { type: String, default: "", trim: true, maxlength: 140 },
        registrationState: { type: String, default: "", trim: true, maxlength: 80 },
        registrationExpiresAt: { type: Date, default: null },
        evidenceReference: { type: String, default: "", trim: true, maxlength: 240 },
        status: { type: String, enum: ["not_submitted", "submitted", "clinic_reviewed", "rejected"], default: "not_submitted" },
        submittedAt: { type: Date, default: null },
        reviewedAt: { type: Date, default: null },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reviewNote: { type: String, default: "", trim: true, maxlength: 1000 },
        events: { type: [{ status: String, at: Date, actorId: String, note: String, evidenceReference: String, _id: false }], default: [] },
      }, { _id: false }),
      default: undefined,
    },

    billingProfile: {
      enabled: { type: Boolean, default: true },
      consultationFee: { type: Number, default: null, min: 0, max: 1000000 },
      followUpFee: { type: Number, default: null, min: 0, max: 1000000 },
      freeFollowUpDays: { type: Number, default: 0, min: 0, max: 365 },
      walkInFee: { type: Number, default: null, min: 0, max: 1000000 },
      reservationFee: { type: Number, default: null, min: 0, max: 1000000 },
      appointmentFee: { type: Number, default: null, min: 0, max: 1000000 },
      emergencyFee: { type: Number, default: null, min: 0, max: 1000000 },
    },

    doctorSchedule: {
      workingDays: {
        type: [String],
        enum: WEEK_DAYS,
        default: () => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      },
      startTime: {
        type: String,
        default: "09:00",
        trim: true,
      },
      endTime: {
        type: String,
        default: "17:00",
        trim: true,
      },
      isOnBreak: {
        type: Boolean,
        default: false,
      },
      roomNumber: {
        type: String,
        default: "",
        trim: true,
        maxlength: 50,
      },
      unavailableDates: {
        type: [String],
        default: [],
      },
    },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, email: 1 }, { unique: true, name: "tenant_staff_email_unique" });

export { WEEK_DAYS };
schema.plugin(tenantScopedPlugin);

export default mongoose.model("User", schema);
