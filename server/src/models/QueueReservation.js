import mongoose from "mongoose";
import tenantScopedPlugin from "./tenantScopedPlugin.js";

const queueReservationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    patientId: { type: String, default: "", trim: true },
    patientName: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    department: { type: String, required: true, trim: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorName: { type: String, required: true, trim: true },
    urgency: { type: String, enum: ["normal", "emergency"], default: "normal", index: true },
    patientRequestedUrgency: { type: String, enum: ["", "emergency"], default: "" },
    reservationDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    status: {
      type: String,
      enum: ["reserved", "checked_in", "cancelled", "expired"],
      default: "reserved",
      index: true,
    },
    token: { type: mongoose.Schema.Types.ObjectId, ref: "Token", default: null },
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
    checkedInAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true }
);

queueReservationSchema.index({ tenantId: 1, doctor: 1, reservationDate: 1, createdAt: 1 });
queueReservationSchema.index({ tenantId: 1, patient: 1, reservationDate: 1, status: 1 });
queueReservationSchema.index(
  { tenantId: 1, patient: 1, reservationDate: 1 },
  {
    unique: true,
    name: "tenant_patient_daily_queue_reservation_unique",
    partialFilterExpression: { status: "reserved" },
  }
);
queueReservationSchema.plugin(tenantScopedPlugin);

export default mongoose.model("QueueReservation", queueReservationSchema);
