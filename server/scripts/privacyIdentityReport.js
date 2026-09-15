import "dotenv/config";
import mongoose from "mongoose";

// Read-only, aggregate-only review. Does not claim, unlink, merge or export patient records.
// Run against a backup/staging copy, using a least-privilege database account.
if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI for a read-only identity review.");
try {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const patients = db.collection("patients");
  const counts = await patients.aggregate([
    { $group: {
      _id: null,
      total: { $sum: 1 },
      unlinked: { $sum: { $cond: [{ $eq: [{ $type: "$globalPatientId" }, "objectId"] }, 0, 1] } },
      linkedWithoutProvenance: { $sum: { $cond: [
        { $and: [{ $eq: [{ $type: "$globalPatientId" }, "objectId"] },
          { $not: [{ $in: ["$identityLink.method", ["verified_global_registration", "clinic_verified_claim"]] }] }] }, 1, 0] } },
    } },
  ]).toArray();
  const [linkedReview] = await patients.aggregate([
    { $match: { globalPatientId: { $type: "objectId" } } },
    { $lookup: { from: "globalpatients", localField: "globalPatientId", foreignField: "_id", as: "account" } },
    { $project: { email: 1, account: { $first: "$account" } } },
    { $group: { _id: null,
      missingAccount: { $sum: { $cond: [{ $eq: [{ $type: "$account._id" }, "objectId"] }, 0, 1] } },
      contactMismatch: { $sum: { $cond: [{ $and: [
        { $ne: ["$email", null] }, { $ne: ["$email", ""] },
        { $eq: [{ $type: "$account._id" }, "objectId"] },
        { $ne: ["$email", "$account.email"] },
      ] }, 1, 0] } },
    } },
  ]).toArray();
  console.log(JSON.stringify({ ...counts[0], ...linkedReview, _id: undefined }, null, 2));
  console.log("Counts are review indicators, not proof of mislinking. No patient identifiers or medical data were exported.");
} finally {
  await mongoose.disconnect();
}
