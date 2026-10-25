import mongoose from "mongoose";
import SystemAdmission from "../models/SystemAdmission.js";
mongoose.set("transactionAsyncLocalStorage", true);
export async function withSharedAdmission(key, work) {
  try { await SystemAdmission.updateOne({ _id: key }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  return mongoose.connection.transaction(async () => {
    // A non-no-op write serializes the later exists/create operations on every
    // worker. It also covers records created before this release (no backfill).
    await SystemAdmission.updateOne({ _id: key }, { $inc: { revision: 1 } });
    return work();
  }, { readPreference: "primary", maxCommitTimeMS: 10000 });
}
