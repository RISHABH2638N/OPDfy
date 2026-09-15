import mongoose from "mongoose";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const notificationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    readAt: {
      type: Date,
      default: null,
      index: true,
    },
    emailSentAt: {
      type: Date,
      default: null,
    },
    dedupeKey: {
      type: String,
      default: undefined,
      trim: true,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ patient: 1, createdAt: -1 });
notificationSchema.index(
  { tenantId: 1, dedupeKey: 1 },
  {
    unique: true,
    sparse: true,
    name: "tenant_notification_dedupe_unique",
  }
);

notificationSchema.plugin(tenantScopedPlugin);

export default mongoose.model("Notification", notificationSchema);
