/**
 * Extend a preexisting 50-patient OPDfy STAGING manifest to 75 distinct patients.
 * Reissues 30-minute staging JWTs for the existing 50, and creates just 25 new
 * synthetic accounts. Does not change application routes or authentication logic.
 *
 * Run only from OPDfy/server, with STAGING MONGO_URI and STAGING JWT_SECRET.
 * This script deliberately refuses any database except `opdfy_staging`.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Tenant from "../src/models/Tenant.js";
import GlobalPatient from "../src/models/GlobalPatient.js";
import { resolvePatientMembership, assertVerifiedMembership } from "../src/services/patientMembershipService.js";

function arg(name, defaultValue = "") {
  const i = process.argv.indexOf(name);
  return i < 0 ? defaultValue : String(process.argv[i + 1] || "");
}

function assertOutsideRepo(fileName, serverRoot) {
  if (!path.isAbsolute(fileName)) throw new Error("Manifest paths must be absolute.");
  const relative = path.relative(serverRoot, path.resolve(fileName));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Manifest paths must be OUTSIDE the OPDfy server repository.");
  }
}

async function main() {
  const slug = arg("--slug").trim();
  const sourcePath = arg("--from").trim();
  const outPath = arg("--out").trim();
  const uri = String(process.env.MONGO_URI || "").trim();
  const secret = String(process.env.JWT_SECRET || "").trim();
  const serverRoot = path.resolve(import.meta.dirname, "../..");
  if (process.env.OPDFY_SEED_CONFIRM !== "SEED_OPDFY_STAGING_ONLY") {
    throw new Error("Set OPDFY_SEED_CONFIRM=SEED_OPDFY_STAGING_ONLY after verifying Render STAGING secrets.");
  }
  if (slug !== "opdfy-test-clinic") throw new Error("Refusing any clinic except opdfy-test-clinic.");
  if (!sourcePath || !outPath) throw new Error("Supply --from and --out absolute paths.");
  assertOutsideRepo(sourcePath, serverRoot);
  assertOutsideRepo(outPath, serverRoot);
  if (path.resolve(sourcePath) === path.resolve(outPath) || existsSync(outPath)) {
    throw new Error("Output must be a NEW file; existing token manifest cannot be overwritten.");
  }
  let url;
  try { url = new URL(uri); } catch { throw new Error("Staging MONGO_URI is missing or invalid."); }
  if (!url.protocol.startsWith("mongodb")) throw new Error("MONGO_URI must be a MongoDB URI.");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database !== "opdfy_staging") throw new Error("REFUSED: MONGO_URI must select the opdfy_staging database explicitly.");
  if (secret.length < 24) throw new Error("Staging JWT_SECRET missing or suspiciously short.");

  const original = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (original.kind !== "opdfy-staging-loadtest-patients-v1"
    || original.host !== "https://opdfy-testest.onrender.com"
    || original.database !== "opdfy_staging"
    || original.clinicSlug !== slug
    || !/^lt[0-9a-f]+$/i.test(String(original.batchId || ""))
    || !Array.isArray(original.patients)
    || original.patients.length !== 50) {
    throw new Error("Expected a valid original 50-patient STAGING manifest; no changes made.");
  }
  const globalIds = original.patients.map(p => String(p.globalPatientId || ""));
  if (new Set(globalIds).size !== 50 || globalIds.some(id => !/^[a-f0-9]{24}$/i.test(id))) {
    throw new Error("Original manifest contains duplicate or invalid patient IDs.");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  if (mongoose.connection.name !== "opdfy_staging") throw new Error("Connected database mismatch; refusing writes.");
  const tenant = await Tenant.findOne({ slug }).select("_id slug status").lean();
  if (!tenant) throw new Error("Staging clinic not found; no changes made.");

  const patients = [];
  for (let i = 0; i < 50; i++) {
    const entry = original.patients[i];
    const patient = await GlobalPatient.findById(globalIds[i]);
    if (!patient || patient.status !== "active" || !patient.profileCompleted
      || !patient.email?.endsWith("@example.invalid")
      || !/^OPDfy Synthetic Patient\b/.test(patient.name || "")
      || patient.email !== entry.email) {
      throw new Error(`Original synthetic patient ${i + 1} not verified. No new accounts created.`);
    }
    const membership = await resolvePatientMembership({ tenantId: tenant._id, globalPatient: patient });
    assertVerifiedMembership(membership);
    const token = jwt.sign(
      { id: String(patient._id), role: "patient-global", ver: Number(patient.tokenVersion || 0) },
      secret, { expiresIn: "30m", algorithm: "HS256" },
    );
    patients.push({ index: i + 1, email: patient.email, globalPatientId: String(patient._id), token });
  }
  console.log("Verified 50 original synthetic staging accounts; reissued short-lived staging tokens.");
  const batchId = `lt${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}${crypto.randomBytes(3).toString("hex")}`;
  for (let i = 51; i <= 75; i++) {
    const email = `${batchId}-p${String(i).padStart(2, "0")}@example.invalid`;
    const patient = await GlobalPatient.create({
      email, name: `OPDfy Synthetic Patient ${i}`, phone: "", status: "active",
      profileCompleted: true, profileUpdatedAt: new Date(),
    });
    const membership = await resolvePatientMembership({ tenantId: tenant._id, globalPatient: patient });
    assertVerifiedMembership(membership);
    const token = jwt.sign(
      { id: String(patient._id), role: "patient-global", ver: Number(patient.tokenVersion || 0) },
      secret, { expiresIn: "30m", algorithm: "HS256" },
    );
    patients.push({ index: i, email, globalPatientId: String(patient._id), token });
    if (i % 5 === 0) console.log(`Added ${i - 50}/25 new synthetic staging patients.`);
  }
  const manifest = {
    kind: "opdfy-staging-loadtest-patients-v1",
    host: "https://opdfy-testest.onrender.com", database: "opdfy_staging",
    clinicSlug: slug, batchId, sourceBatchId: original.batchId,
    createdAt: new Date().toISOString(),
    tokenExpiresApprox: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
    patients,
  };
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log("READY: 75 distinct synthetic patients (50 reused + 25 created). Staging ONLY.");
  console.log(`Private access tokens saved at: ${path.resolve(outPath)}`);
  console.log("Do not upload or commit that JSON file. Tokens expire in ~30 minutes.");
}

try { await main(); }
catch (error) { console.error(`FAILED: ${error?.message || "Unexpected error"}`); process.exitCode = 1; }
finally { try { await mongoose.disconnect(); } catch {} }
