import mongoose from "mongoose";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const feedbackSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    consultation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Consultation",
      required: true,
      unique: true,
      index: true,
    },
    token: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Token",
      required: true,
      index: true,
    },
    department: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  { timestamps: true }
);

feedbackSchema.index({ doctor: 1, createdAt: -1 });

feedbackSchema.plugin(tenantScopedPlugin);

export default mongoose.model("Feedback", feedbackSchema);
