/** Reissue fresh 30-minute JWTs for an existing 75-account staging-only manifest.
 * No new patient accounts are created. Writes to a new private JSON manifest.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Tenant from "../src/models/Tenant.js";
import GlobalPatient from "../src/models/GlobalPatient.js";
import { resolvePatientMembership, assertVerifiedMembership } from "../src/services/patientMembershipService.js";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? "" : String(process.argv[i + 1] || "");
}
function assertExternal(p) {
  if (!path.isAbsolute(p)) throw new Error("Use absolute manifest paths.");
  const root = path.resolve(import.meta.dirname, "../..");
  const rel = path.relative(root, path.resolve(p));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error("Manifest must stay outside OPDfy Git repository.");
  }
}
async function main() {
  if (process.env.OPDFY_SEED_CONFIRM !== "SEED_OPDFY_STAGING_ONLY") throw new Error("Explicit staging confirmation missing.");
  const uri = String(process.env.MONGO_URI || "").trim();
  const secret = String(process.env.JWT_SECRET || "").trim();
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error("Invalid staging MONGO_URI."); }
  if (!parsed.protocol.startsWith("mongodb") || decodeURIComponent(parsed.pathname.slice(1)) !== "opdfy_staging") {
    throw new Error("Refused: expected explicitly selected opdfy_staging database.");
  }
  if (secret.length < 24) throw new Error("Staging JWT_SECRET missing/too short.");
  const source = arg("--from"), target = arg("--out");
  if (!source || !target) throw new Error("--from and --out are required.");
  assertExternal(source); assertExternal(target);
  if (path.resolve(source) === path.resolve(target) || existsSync(target)) {
    throw new Error("Refusing to overwrite existing patient credentials.");
  }
  const old = JSON.parse(readFileSync(source, "utf8"));
  if (old.kind !== "opdfy-staging-loadtest-patients-v1" || old.database !== "opdfy_staging"
    || old.host !== "https://opdfy-testest.onrender.com" || old.clinicSlug !== "opdfy-test-clinic"
    || !Array.isArray(old.patients) || old.patients.length !== 75) {
    throw new Error("Not an OPDfy staging 75-patient manifest.");
  }
  const ids = old.patients.map(p => String(p.globalPatientId || ""));
  if (new Set(ids).size !== 75 || ids.some(id => !/^[a-f0-9]{24}$/i.test(id))) throw new Error("Duplicate/invalid synthetic IDs.");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  if (mongoose.connection.name !== "opdfy_staging") throw new Error("Connected DB mismatch.");
  const tenant = await Tenant.findOne({ slug: "opdfy-test-clinic" }).select("_id").lean();
  if (!tenant) throw new Error("Staging tenant missing.");
  const fresh = [];
  for (const [index, entry] of old.patients.entries()) {
    const patient = await GlobalPatient.findById(entry.globalPatientId);
    if (!patient || patient.status !== "active" || !patient.profileCompleted
      || !patient.email?.endsWith("@example.invalid") || patient.email !== entry.email
      || !/^OPDfy Synthetic Patient\b/.test(patient.name || "")) {
      throw new Error(`Invalid synthetic patient at position ${index + 1}.`);
    }
    const membership = await resolvePatientMembership({ tenantId: tenant._id, globalPatient: patient });
    assertVerifiedMembership(membership);
    const token = jwt.sign(
      { id: String(patient._id), role: "patient-global", ver: Number(patient.tokenVersion || 0) },
      secret, { expiresIn: "30m", algorithm: "HS256" },
    );
    fresh.push({ index: index + 1, email: patient.email, globalPatientId: String(patient._id), token });
    if ((index + 1) % 25 === 0) console.log(`Refreshed ${index + 1}/75 synthetic staging identities.`);
  }
  const refreshed = {
    ...old,
    createdAt: new Date().toISOString(),
    tokenExpiresApprox: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
    patients: fresh,
  };
  writeFileSync(target, JSON.stringify(refreshed, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log("READY: refreshed 75 patient tokens. No new patient accounts created.");
  console.log(`Private credentials: ${path.resolve(target)}`);
}
try { await main(); }
catch (error) { console.error(`FAILED: ${error?.message || "Unexpected error"}`); process.exitCode = 1; }
finally { try { await mongoose.disconnect(); } catch {} }
