import test from "node:test";
import assert from "node:assert/strict";
import { planBatch } from "../src/utils/planOnlineReservationBatch.js";
const entries = Array.from({ length: 10 }, (_, i) => ({ patient: { _id: `patient-${i}` } }));

test("limit 5 with 10 concurrent patients allocates exactly 5", () => {
  const { selected, outcomes } = planBatch({ entries, alreadyReserved: [], used: 0, limit: 5, doctorName: "Test" });
  assert.deepEqual(selected, [0, 1, 2, 3, 4]);
  assert.equal(outcomes.slice(5).filter((item) => item.error?.code === "ONLINE_RESERVATION_LIMIT").length, 5);
});

test("lowered limit preserves existing patients but blocks additions", () => {
  const { selected, outcomes } = planBatch({ entries, alreadyReserved: [], used: 30, limit: 20, doctorName: "Test" });
  assert.equal(selected.length, 0);
  assert.equal(outcomes.filter((item) => item.error?.status === 409).length, 10);
});

test("cancellation release appears as lower authoritative used count", () => {
  const { selected } = planBatch({ entries, alreadyReserved: [], used: 3, limit: 5, doctorName: "Test" });
  assert.deepEqual(selected, [0, 1]);
});

test("duplicate patient in same batch is rejected independently", () => {
  const dup = [entries[0], entries[0], entries[1]];
  const { selected, outcomes } = planBatch({ entries: dup, alreadyReserved: [], used: 0, limit: 5, doctorName: "Test" });
  assert.deepEqual(selected, [0, 2]);
  assert.equal(outcomes[1].error.code, "ALREADY_RESERVED");
});

test("already reserved patient is rejected without consuming capacity", () => {
  const { selected, outcomes } = planBatch({ entries, alreadyReserved: [{ patient: "patient-0" }], used: 1, limit: 2, doctorName: "Test" });
  assert.deepEqual(selected, [1]);
  assert.equal(outcomes[0].error.code, "ALREADY_RESERVED");
});
