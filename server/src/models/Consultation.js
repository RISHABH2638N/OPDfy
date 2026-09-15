import mongoose from "mongoose";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const consultationSchema =
  new mongoose.Schema(
    {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
      patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true,
        index: true,
      },

      token: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Token",
        required: true,
        unique: true,
      },

      doctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      department: {
        type: String,
        required: true,
        trim: true,
      },

      symptoms: {
        type: String,
        default: "",
        trim: true,
      },

      diagnosis: {
        type: String,
        required: true,
        trim: true,
      },

      prescription: {
        type: String,
        default: "",
        trim: true,
      },

      medicines: {
        type: [
          {
            name: { type: String, trim: true, default: "" },
            dosage: { type: String, trim: true, default: "" },
            frequency: { type: String, trim: true, default: "" },
            duration: { type: String, trim: true, default: "" },
            instructions: { type: String, trim: true, default: "" },
          },
        ],
        default: [],
      },

      testsRecommended: {
        type: [String],
        default: [],
      },

      labReferral: {
        enabled: { type: Boolean, default: false },
        referralDate: { type: Date, default: null },
        priority: { type: String, enum: ["routine", "urgent"], default: "routine" },
        status: { type: String, enum: ["pending", "completed"], default: "pending" },
        completedAt: { type: Date, default: null },
      },

      advice: {
        type: String,
        default: "",
        trim: true,
      },

      notes: {
        type: String,
        default: "",
        trim: true,
      },

      followUpDate: {
        type: Date,
        default: null,
      },

      printDesk: {
        printedAt: { type: Date, default: null },
        printedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      },

      status: {
        type: String,
        enum: ["completed"],
        default: "completed",
      },
    },
    {
      timestamps: true,
    }
  );

/*
 * Allows fast retrieval of a
 * patient's consultation history.
 */
consultationSchema.index({
  patient: 1,
  createdAt: -1,
});

consultationSchema.plugin(tenantScopedPlugin);

const Consultation =
  mongoose.model(
    "Consultation",
    consultationSchema
  );

export default Consultation;
