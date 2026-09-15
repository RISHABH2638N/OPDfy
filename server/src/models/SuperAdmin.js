import mongoose from "mongoose";

const superAdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true }
);

export default mongoose.model("SuperAdmin", superAdminSchema);
