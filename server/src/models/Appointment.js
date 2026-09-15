import mongoose from "mongoose";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const appointmentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    patientId: { type: String, default: "", trim: true },
    patientName: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorName: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true, index: true },
    appointmentDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    reason: { type: String, default: "", trim: true, maxlength: 500 },
    bookingSource: { type: String, enum: ["patient", "reception"], default: "patient" },
    status: {
      type: String,
      enum: ["booked", "checked_in", "cancelled", "completed", "skipped", "missed"],
      default: "booked",
      index: true,
    },
    token: { type: mongoose.Schema.Types.ObjectId, ref: "Token", default: null },
    followUpConsultation: { type: mongoose.Schema.Types.ObjectId, ref: "Consultation", default: null },
    checkedInAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: "", trim: true, maxlength: 300 },
    cancelledByRole: { type: String, enum: ["", "patient", "receptionist", "admin"], default: "" },
    missedAt: { type: Date, default: null },
    rescheduledAt: { type: Date, default: null },
    rescheduleCount: { type: Number, default: 0, min: 0 },
    rescheduleHistory: [{
      fromDate: { type: String, default: "" },
      fromTime: { type: String, default: "" },
      toDate: { type: String, default: "" },
      toTime: { type: String, default: "" },
      fromDoctorName: { type: String, default: "", trim: true },
      toDoctorName: { type: String, default: "", trim: true },
      reason: { type: String, default: "", trim: true, maxlength: 300 },
      actorRole: { type: String, enum: ["patient", "receptionist", "admin"], default: "patient" },
      at: { type: Date, default: Date.now },
      _id: false,
    }],
    billing: {
      feeType: { type: String, enum: ["consultation", "walk_in", "reservation", "appointment", "follow_up", "free_follow_up"], default: "consultation" },
      quotedAmount: { type: Number, default: 0, min: 0 },
      paidAmount: { type: Number, default: 0, min: 0 },
      discountAmount: { type: Number, default: 0, min: 0 },
      status: { type: String, enum: ["pending", "paid", "waived", "refunded"], default: "pending", index: true },
      method: { type: String, enum: ["", "cash", "upi", "card", "other", "waived"], default: "" },
      receiptNumber: { type: String, default: "", trim: true, index: true },
      transactionReference: { type: String, default: "", trim: true, maxlength: 120 },
      overrideReason: { type: String, default: "", trim: true, maxlength: 240 },
      paidAt: { type: Date, default: null },
      collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      refundedAt: { type: Date, default: null },
      refundReason: { type: String, default: "", trim: true, maxlength: 240 },
    },
    slotKey: { type: String, default: undefined, trim: true },
  },
  { timestamps: true, optimisticConcurrency: true }
);

appointmentSchema.index({ tenantId: 1, doctor: 1, appointmentDate: 1, startTime: 1 });
appointmentSchema.index(
  { tenantId: 1, slotKey: 1 },
  {
    unique: true,
    name: "tenant_appointment_slot_unique",
    partialFilterExpression: { slotKey: { $type: "string" } },
  }
);
appointmentSchema.index({ tenantId: 1, followUpConsultation: 1 }, {
  unique: true, name: "one_active_appointment_per_followup",
  partialFilterExpression: {
    followUpConsultation: { $type: "objectId" },
    status: { $in: ["booked", "checked_in"] },
  },
});
appointmentSchema.index({ tenantId: 1, patient: 1, appointmentDate: -1 });

appointmentSchema.index({ tenantId: 1, patient: 1, appointmentDate: 1 }, {
  unique: true, name: "one_active_appointment_per_patient_day",
  partialFilterExpression: { status: { $in: ["booked", "checked_in"] } },
});
appointmentSchema.plugin(tenantScopedPlugin);

export default mongoose.model("Appointment", appointmentSchema);
