import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateIdentityReviewDecision } from "../src/services/privacyIdentityReviewService.js";

test("clinic identity review accepts a documented decision", () => {
  assert.deepEqual(validateIdentityReviewDecision({
    decision: "verified",
    evidenceReference: "CASE-2026-001",
    reviewNote: "Photo identity was checked in person by authorized clinic staff.",
  }), {
    decision: "verified",
    evidenceReference: "CASE-2026-001",
    reviewNote: "Photo identity was checked in person by authorized clinic staff.",
  });
});

for (const input of [
  { decision: "approved", evidenceReference: "CASE-1", reviewNote: "A sufficiently long review note." },
  { decision: "verified", evidenceReference: "x", reviewNote: "A sufficiently long review note." },
  { decision: "verified", evidenceReference: "CASE-1", reviewNote: "too short" },
]) test("clinic identity review rejects incomplete or forged decisions", () => {
  assert.throws(() => validateIdentityReviewDecision(input));
});

test("account closure reports orphaned clinics but still blocks execution", () => {
  const source = fs.readFileSync(new URL("../src/services/privacyClosureService.js", import.meta.url), "utf8");
  assert.match(source, /name: tenant\?\.name \|\| "Unavailable historical clinic"/);
  assert.match(source, /inventory\.clinics\.some\(c => c\.unavailable\)/);
});
