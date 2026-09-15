import mongoose from "mongoose";

// Existing clinic onboarding already requires a replica set. Carry the same
// MongoDB session through nested service/model calls without changing their API.
mongoose.set("transactionAsyncLocalStorage", true);

export async function databaseTransaction(work) {
  try {
    return await mongoose.connection.transaction(work, { readPreference: "primary", maxCommitTimeMS: 10000 });
  } catch (error) {
    if (error?.code === 11000 || error?.name === "VersionError") {
      throw Object.assign(new Error("This visit changed during the request. Refresh and try again."), { status: 409, code: "VISIT_CONFLICT" });
    }
    throw error;
  }
}
