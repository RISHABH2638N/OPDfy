import mongoose from "mongoose";
import tenantScopedPlugin from "./tenantScopedPlugin.js";

const waitingLoungeDisplaySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Legacy plaintext key remains optional for migration only. New records use a hash for lookup
    // and authenticated encryption solely so clinic admins can reopen the configured TV link.
    accessKey: { type: String, required: false, unique: true, sparse: true, index: true, select: false },
    accessKeyHash: { type: String, required: false, unique: true, sparse: true, index: true, select: false },
    accessKeyEncrypted: { type: String, required: false, select: false },
    accessKeyExpiresAt: { type: Date, default: null, index: true },
    department: { type: String, default: "All Departments", trim: true, maxlength: 80 },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    voice: {
      enabled: { type: Boolean, default: true },
      language: { type: String, enum: ["en-IN", "hi-IN"], default: "en-IN" },
      volume: { type: Number, min: 0.2, max: 1, default: 1 },
    },
    isEnabled: { type: Boolean, default: true, index: true },
    lastConfiguredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

waitingLoungeDisplaySchema.index({ tenantId: 1, name: 1 });
waitingLoungeDisplaySchema.plugin(tenantScopedPlugin);

export default mongoose.model("WaitingLoungeDisplay", waitingLoungeDisplaySchema);
