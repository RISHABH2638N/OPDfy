/**
 * Provision up to 50 throwaway GLOBAL patients and clinic memberships in OPDfy STAGING only.
 *
 * Run from OPDfy/server after installing dependencies:
 * node scripts/seedStagingLoadPatients.mjs --count 50 --slug opdfy-test-clinic --out "C:\\...\\opdfy-load-test\\staging_patients_50.json"
 *
 * NO OTP bypass endpoint or server changes. Tokens are signed OFFLINE using the
 * exact staging JWT_SECRET and have the same 30-minute lifespan as production.
 * Keep the generated token manifest PRIVATE and OUT of version control.
 */
import "dotenv/config";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Tenant from "../src/models/Tenant.js";
import GlobalPatient from "../src/models/GlobalPatient.js";
import { resolvePatientMembership, assertVerifiedMembership } from "../src/services/patientMembershipService.js";

function arg(name, defaultValue) {
  const idx = process.argv.indexOf(name);
  return idx < 0 ? defaultValue : String(process.argv[idx + 1] || "");
}

async function main() {
  const count = Number(arg("--count", "50"));
  const slug = arg("--slug", "").trim();
  const outInput = arg("--out", "").trim();
  const uri = String(process.env.MONGO_URI || "").trim();
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (process.env.OPDFY_SEED_CONFIRM !== "SEED_OPDFY_STAGING_ONLY") throw new Error("Set OPDFY_SEED_CONFIRM=SEED_OPDFY_STAGING_ONLY after reviewing target database.");
  if (!Number.isInteger(count) || count < 2 || count > 50) throw new Error("--count must be 2..50.");
  if (slug !== "opdfy-test-clinic") throw new Error("Only opdfy-test-clinic is allowed. Change this script deliberately only after review.");
  if (!uri.startsWith("mongodb+srv://") && !uri.startsWith("mongodb://")) throw new Error("MONGO_URI missing or invalid.");
  let url;
  try { url = new URL(uri); } catch { throw new Error("MONGO_URI could not be parsed."); }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (dbName !== "opdfy_staging") throw new Error(`REFUSED: MONGO_URI path database must be opdfy_staging; got ${dbName || "(none)"}.`);
  if (secret.length < 24) throw new Error("Staging JWT_SECRET missing or suspiciously short.");
  if (!outInput) throw new Error("--out must be an absolute path OUTSIDE your Git repository.");
  const outputPath = path.resolve(outInput);
  if (!path.isAbsolute(outInput)) throw new Error("--out must be absolute.");
  const serverRoot = path.resolve(import.meta.dirname, "../..");
  const outRelativeToServer = path.relative(serverRoot, outputPath);
  if (outRelativeToServer === "" || (!outRelativeToServer.startsWith("..") && !path.isAbsolute(outRelativeToServer))) {
    throw new Error("--out must be outside the OPDfy server repository. Use Desktop/opdfy-load-test.");
  }
  if (existsSync(outputPath)) throw new Error("Output file already exists; refusing to overwrite existing credentials.");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  if (mongoose.connection.name !== "opdfy_staging") throw new Error("CONNECTED DATABASE IS NOT opdfy_staging. Nothing created.");
  const tenant = await Tenant.findOne({ slug }).select("_id slug status").lean();
  if (!tenant) throw new Error("Staging clinic slug not found. Nothing created.");

  // Random namespace avoids collision with previously created test data.
  const batchId = `lt${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}${crypto.randomBytes(3).toString("hex")}`;
  const patients = [];
  for (let i = 1; i <= count; i++) {
    const email = `${batchId}-p${String(i).padStart(2, "0")}@example.invalid`;
    const globalPatient = await GlobalPatient.create({
      email,
      name: `OPDfy Synthetic Patient ${String(i).padStart(2, "0")}`,
      phone: "",
      status: "active",
      profileCompleted: true,
      profileUpdatedAt: new Date(),
    });
    const membership = await resolvePatientMembership({ tenantId: tenant._id, globalPatient });
    assertVerifiedMembership(membership);
    // Production patient access tokens expire after 30m; do not lengthen test sessions.
    const token = jwt.sign(
      { id: String(globalPatient._id), role: "patient-global", ver: Number(globalPatient.tokenVersion || 0) },
      secret,
      { expiresIn: "30m", algorithm: "HS256" },
    );
    patients.push({ index: i, email, globalPatientId: String(globalPatient._id), token });
    if (i % 10 === 0 || i === count) console.log(`Created ${i}/${count} staging synthetic patients.`);
  }
  const manifest = {
    kind: "opdfy-staging-loadtest-patients-v1",
    host: "https://opdfy-testest.onrender.com",
    database: "opdfy_staging",
    clinicSlug: slug,
    batchId,
    createdAt: new Date().toISOString(),
    tokenExpiresApprox: new Date(Date.now() + 29 * 60 * 1000).toISOString(),
    patients,
  };
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(`READY: ${count} staging-only patient identities, with clinic memberships.`);
  console.log(`Credentials saved privately to: ${outputPath}`);
  console.log("This file contains LIVE staging access tokens. Never commit, upload or share it. Tokens expire in ~30 minutes.");
  console.log("Test reservations may count against the doctor's daily capacity; use API cancellation after runs.");
}

try { await main(); }
catch (error) { console.error(`FAILED: ${error?.message || "Unexpected error"}`); process.exitCode = 1; }
finally { try { await mongoose.disconnect(); } catch {} }
