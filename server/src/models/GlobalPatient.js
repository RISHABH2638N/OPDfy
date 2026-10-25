import mongoose from "mongoose";

const globalPatientSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    // Absent on legacy accounts until email-verified password setup. The partial
    // unique index allows those accounts while enforcing global, normalized names.
    username: { type: String, lowercase: true, trim: true, match: /^[a-z0-9][a-z0-9_.]{2,29}$/ },
    passwordHash: { type: String, select: false },
    credentialsSetAt: { type: Date, default: null },
    phone: { type: String, default: "", trim: true, maxlength: 20 },

    // SaaS Day 7: one patient-owned health profile shared by the patient
    // across clinics. Clinic consultation/diagnosis/prescription records remain
    // tenant-owned and are never copied into this global profile.
    dateOfBirth: { type: Date, default: null },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", ""],
      default: "",
    },
    bloodGroup: {
      type: String,
      enum: ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      default: "",
    },
    allergies: { type: [String], default: [] },
    medicalHistory: { type: [String], default: [] },
    currentMedications: { type: [String], default: [] },
    pastSurgeries: { type: [String], default: [] },
    emergencyContact: {
      name: { type: String, default: "", trim: true, maxlength: 120 },
      phone: { type: String, default: "", trim: true, maxlength: 20 },
    },
    profileCompleted: { type: Boolean, default: false, index: true },
    profileUpdatedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },
    lastLoginAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closureRequest: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyRequest", default: null },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
    privacyRevision: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true }
);

globalPatientSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });

export default mongoose.model("GlobalPatient", globalPatientSchema);
