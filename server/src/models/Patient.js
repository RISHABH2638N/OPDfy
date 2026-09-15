import mongoose from "mongoose";

import tenantScopedPlugin from "./tenantScopedPlugin.js";
const patientSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    // Global identity link. Clinical/profile data below remains tenant-owned.
    globalPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GlobalPatient",
      default: undefined,
      index: true,
    },
    // Provenance for newly created global memberships. Existing legacy links
    // are intentionally left unclassified until a separate identity review.
    identityLink: {
      method: { type: String, enum: ["verified_global_registration", "clinic_verified_claim"], default: undefined },
      linkedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    /* =====================================================
       PATIENT ID
    ===================================================== */

    patientId: {
      type: String,
      unique: true,
      default: () =>
        `PT-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase()}`,
    },

    /* =====================================================
       BASIC INFORMATION
    ===================================================== */

    name: {
      type: String,
      default: "",
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      // Never store an empty string on an optional unique field.
      // Returning undefined means MongoDB will omit the field.
      set: (value) => {
        const cleaned = String(value || "").trim().toLowerCase();
        return cleaned || undefined;
      },
    },

    /*
     * Phone is unique only when it actually exists.
     *
     * sparse: true means patients who don't have a phone
     * number yet are not included in the unique index.
     *
     * IMPORTANT:
     * We should NOT save phone: "" for incomplete patients.
     */

    phone: {
      type: String,
      trim: true,
      // Same protection as email: phone-only/email-only walk-ins must
      // not create duplicate empty-string values in a unique index.
      set: (value) => {
        const cleaned = String(value || "").trim();
        return cleaned || undefined;
      },
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other", ""],
      default: "",
    },

    bloodGroup: {
      type: String,
      enum: [
        "",
        "A+",
        "A-",
        "B+",
        "B-",
        "AB+",
        "AB-",
        "O+",
        "O-",
      ],
      default: "",
    },

    /* =====================================================
       MEDICAL INFORMATION
    ===================================================== */

    allergies: {
      type: [String],
      default: [],
    },

    medicalHistory: {
      type: [String],
      default: [],
    },

    currentMedications: {
      type: [String],
      default: [],
    },

    pastSurgeries: {
      type: [String],
      default: [],
    },

    /* =====================================================
       EMERGENCY CONTACT
    ===================================================== */

    emergencyContact: {
      name: {
        type: String,
        default: "",
        trim: true,
      },

      phone: {
        type: String,
        default: "",
        trim: true,
      },
    },

    /* =====================================================
       PROFILE STATUS
    ===================================================== */

    privacyContactDisabled: { type: Boolean, default: false, index: true },
    profileCompleted: {
      type: Boolean,
      default: false,
    },
  },

  {
    timestamps: true,
  }
);


/* =========================================================
   OPTIONAL CONTACT UNIQUE INDEXES

   A normal `unique + sparse` index still treats an explicitly stored
   empty string as a real value. These partial indexes only enforce
   uniqueness when the contact value is a non-empty string.
========================================================= */

patientSchema.index(
  { tenantId: 1, email: 1 },
  {
    unique: true,
    name: "tenant_patient_email_unique_nonempty",
    partialFilterExpression: {
      email: { $type: "string", $gt: "" },
    },
  }
);

patientSchema.index(
  { tenantId: 1, phone: 1 },
  {
    unique: true,
    name: "tenant_patient_phone_unique_nonempty",
    partialFilterExpression: {
      phone: { $type: "string", $gt: "" },
    },
  }
);


patientSchema.index(
  { tenantId: 1, globalPatientId: 1 },
  {
    unique: true,
    name: "tenant_global_patient_membership_unique",
    partialFilterExpression: {
      globalPatientId: { $type: "objectId" },
    },
  }
);

/* =========================================================
   MODEL
========================================================= */

patientSchema.plugin(tenantScopedPlugin);

const Patient = mongoose.model(
  "Patient",
  patientSchema
);

export default Patient;
