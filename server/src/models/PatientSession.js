import mongoose from "mongoose";

const patientSessionSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GlobalPatient",
      required: true,
      index: true,
    },
    // Only a SHA-256 digest of the opaque browser refresh credential is stored.
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    tokenVersionAtIssue: {
      type: Number,
      required: true,
      min: 0,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    userAgent: {
      type: String,
      default: "",
      maxlength: 300,
    },
  },
  { timestamps: true }
);

// Remembered-device sessions are temporary by design. MongoDB removes them
// after their absolute expiry. Revoked rows remain only until that same date,
// which keeps a short audit window without creating permanent session clutter.
patientSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
patientSessionSchema.index({ patientId: 1, revokedAt: 1, expiresAt: 1, createdAt: -1 });

export default mongoose.model("PatientSession", patientSessionSchema);
