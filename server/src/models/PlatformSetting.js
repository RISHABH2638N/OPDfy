import mongoose from "mongoose";

const platformSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      maxlength: 50,
    },
    productName: {
      type: String,
      default: "OPDfy",
      trim: true,
      maxlength: 80,
    },
    logoUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 420000,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SuperAdmin",
      default: null,
      select: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model("PlatformSetting", platformSettingSchema);
