import test, { mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Feedback from "../src/models/Feedback.js";
import { runWithTenant } from "../src/services/tenantExecutionContext.js";
import { withDoctorRatings } from "../src/services/doctorRatings.js";

test("doctor ratings are tenant scoped, rounded, and expose only summary fields", async () => {
  const tenantId = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const newDoctorId = new mongoose.Types.ObjectId();
  let pipeline;
  const stub = mock.method(Feedback.collection, "aggregate", (stages) => {
    pipeline = stages;
    return { toArray: async () => [{ _id: doctorId, averageRating: 14 / 3, reviewCount: 3 }] };
  });
  try {
    const result = await runWithTenant(tenantId, () => withDoctorRatings([
      { _id: doctorId, name: "Rated", prescriptionProfile: { qualification: "MBBS, MD" } },
      { _id: newDoctorId, name: "New" },
    ]));
    assert.equal(String(pipeline[0].$match.tenantId), String(tenantId));
    assert.deepEqual(pipeline[1].$match.doctor.$in, [doctorId, newDoctorId]);
    assert.deepEqual(result[0].ratingSummary, { averageRating: 4.7, reviewCount: 3 });
    assert.deepEqual(result[1].ratingSummary, { averageRating: null, reviewCount: 0 });
    assert.equal(result[0].prescriptionProfile.qualification, "MBBS, MD");
    assert.equal(JSON.stringify(result).includes('patient'), false);
  } finally { stub.mock.restore(); }
});

test("doctor rating aggregation fails closed without tenant context", async () => {
  await assert.rejects(withDoctorRatings([{ _id: new mongoose.Types.ObjectId() }]), /Tenant execution context/);
});

test("empty doctor roster does not request feedback", async () => {
  assert.deepEqual(await withDoctorRatings([]), []);
});
