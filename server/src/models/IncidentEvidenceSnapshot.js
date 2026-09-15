import mongoose from "mongoose";

const schema = new mongoose.Schema({
  incident: { type: mongoose.Schema.Types.ObjectId, ref: "PrivacyIncident", required: true, unique: true },
  capturedAt: { type: Date, required: true }, capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", required: true },
  range: { from: { type: Date, required: true }, to: { type: Date, required: true } },
  eventCount: { type: Number, required: true, min: 0 }, payload: { type: mongoose.Schema.Types.Mixed, required: true },
  sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ }, reason: { type: String, required: true, maxlength: 500 },
}, { timestamps: true, strict: "throw" });
const locked = next => next(Object.assign(new Error("Evidence snapshots are immutable."), { status: 409 }));
schema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"], locked);
export default mongoose.model("IncidentEvidenceSnapshot", schema);
