import mongoose from "mongoose";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const tokenSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    /*
     * Link this OPD token to
     * the permanent Patient document.
     */
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      default: null,
      index: true,
    },

    /*
     * Human-friendly permanent
     * patient ID, e.g. PT-...
     */
    patientId: {
      type: String,
      default: "",
      trim: true,
    },

    tokenNumber: {
      type: Number,
      required: true,
    },

    patientName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
    },

    department: {
      type: String,
      default: "General OPD",
      trim: true,
    },

    /*
     * Once a doctor calls a token, the token is assigned to that
     * doctor. Waiting tokens remain unassigned and are visible only
     * to doctors belonging to the token's department.
     */
    assignedDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
      index: true,
    },

    referral: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DepartmentReferral",
      default: null,
      index: true,
    },

    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QueueReservation",
      default: null,
      index: true,
    },

    queueSource: {
      type: String,
      enum: ["walk_in", "appointment", "reservation"],
      default: "walk_in",
      index: true,
    },

    status: {
      type: String,
      enum: [
        "waiting",
        "called",
        "completed",
        "skipped",
      ],
      default: "waiting",
    },

    /*
     * Queue urgency selected by the patient or AI assistant.
     * This does not change the department queue numbering; it
     * tells the doctor that the encounter needs emergency handling.
     */
    urgency: {
      type: String,
      enum: ["normal", "emergency"],
      default: "normal",
      index: true,
    },

    /*
     * Front-desk arrival tracking is kept separate from the clinical
     * queue status so existing doctor workflows remain compatible.
     */
    arrivalStatus: {
      type: String,
      enum: ["not_checked_in", "arrived", "no_show"],
      default: "not_checked_in",
      index: true,
    },

    calledAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

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

    queueControl: {
      isOnHold: { type: Boolean, default: false, index: true },
      heldAt: { type: Date, default: null },
      holdReason: { type: String, default: "", trim: true, maxlength: 240 },
      lastInterventionAt: { type: Date, default: null },
      lastInterventionReason: { type: String, default: "", trim: true, maxlength: 300 },
    },

    /* True after the administrator archives the daily queue.
     * Archived tokens remain permanently available in patient history.
     */
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true, optimisticConcurrency: true,
  }
);

/*
 * Useful queue indexes.
 */
tokenSchema.index({
  status: 1,
  department: 1,
  tokenNumber: 1,
});

tokenSchema.index({
  createdAt: -1,
});

tokenSchema.index({
  department: 1,
  status: 1,
  tokenNumber: 1,
});

/*
 * Token numbers are unique ONLY inside a department queue.
 * Example: Orthopedics can have #13 while ENT also has #8.
 */
tokenSchema.index(
  { tenantId: 1, department: 1, tokenNumber: 1 },
  {
    unique: true,
    name: "tenant_department_tokenNumber_unique",
    partialFilterExpression: { isArchived: false },
  }
);

tokenSchema.index({
  assignedDoctor: 1,
  status: 1,
});

/*
 * Exactly one live/history token may be linked to an appointment. The partial
 * filter ignores normal walk-in tokens whose appointment field is null.
 */
tokenSchema.index(
  { appointment: 1 },
  {
    unique: true,
    name: "appointment_token_unique",
    partialFilterExpression: { appointment: { $type: "objectId" } },
  }
);

/* One live/history token per online queue reservation. */
tokenSchema.index(
  { reservation: 1 },
  {
    unique: true,
    name: "reservation_token_unique",
    partialFilterExpression: { reservation: { $type: "objectId" } },
  }
);


// Database constraints close concurrent call/issue races.
tokenSchema.index({ tenantId: 1, assignedDoctor: 1 }, {
  unique: true, name: "one_called_token_per_doctor",
  partialFilterExpression: { isArchived: false, status: "called", assignedDoctor: { $type: "objectId" } },
});
tokenSchema.index({ tenantId: 1, patient: 1 }, {
  unique: true, name: "one_active_token_per_patient",
  partialFilterExpression: { isArchived: false, status: { $in: ["waiting", "called"] }, patient: { $type: "objectId" } },
});

tokenSchema.index(
  { referral: 1 },
  {
    unique: true,
    name: "referral_token_unique",
    partialFilterExpression: { referral: { $type: "objectId" } },
  }
);

tokenSchema.plugin(tenantScopedPlugin);

const Token =
  mongoose.model(
    "Token",
    tokenSchema
  );

export default Token;
