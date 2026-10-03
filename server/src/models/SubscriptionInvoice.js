import mongoose from "mongoose";

// Platform-owned ledger. Clinic APIs never expose or write this collection.
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  requestId: { type: String, required: true, immutable: true, maxlength: 80 },
  fingerprint: { type: String, required: true, immutable: true },
  plan: { type: String, enum: ["Starter", "Growth", "Enterprise", "Custom"], required: true },
  billingCycle: { type: String, enum: ["monthly", "yearly", "setup"], required: true },
  amountPaise: { type: Number, required: true, min: 1, max: 100000000, validate: Number.isSafeInteger },
  dueDate: { type: String, required: true },
  status: { type: String, enum: ["pending", "paid", "void"], default: "pending" },
  paidAt: { type: Date, default: null },
  method: { type: String, enum: ["", "cash", "upi", "card", "bank_transfer", "other"], default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
  settledBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
}, { timestamps: true });
schema.index({ requestId: 1 }, { unique: true });
schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ status: 1, paidAt: -1 });
export default mongoose.model("SubscriptionInvoice", schema);
