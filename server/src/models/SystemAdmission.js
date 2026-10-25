import mongoose from "mongoose";
// System-wide serialization only; never stores tenant, patient or provider data.
const schema = new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 } }, { versionKey: false });
export default mongoose.model("SystemAdmission", schema);
