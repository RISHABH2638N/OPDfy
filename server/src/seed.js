import { safeDiagnostic } from "./utils/privacySafeLog.js";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "./models/User.js";
import { ensureDefaultTenant } from "./services/tenantBootstrapService.js";
import { runWithTenant } from "./services/tenantExecutionContext.js";

dotenv.config();

(async () => {
  try {
    if (process.env.NODE_ENV === "production") throw new Error("Development seeding is disabled in production. Use clinic onboarding.");
    for (const name of ["SEED_ADMIN_PASSWORD", "SEED_DOCTOR_PASSWORD"]) {
      const password = String(process.env[name] || "");
      if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error(`${name} must be 12 characters or more, and at most 72 UTF-8 bytes.`);
    }
    await mongoose.connect(process.env.MONGO_URI);
    const tenant = await ensureDefaultTenant();

    const accounts = [
      { name: "OPD Doctor", email: "doctor@opd.com", password: process.env.SEED_DOCTOR_PASSWORD, role: "doctor" },
      { name: "OPD Admin", email: "admin@opd.com", password: process.env.SEED_ADMIN_PASSWORD, role: "admin" },
    ];

    await runWithTenant(tenant._id, async () => {
      for (const account of accounts) {
        await User.findOneAndUpdate(
        { tenantId: tenant._id, email: account.email },
        {
          tenantId: tenant._id,
          name: account.name,
          email: account.email,
          passwordHash: await bcrypt.hash(account.password, 10),
          role: account.role,
          department: "General OPD",
          $inc: { tokenVersion: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    });

    console.log(`Doctor and admin accounts seeded for clinic: ${tenant.slug}`);
    await mongoose.disconnect();
  } catch (e) {
    console.error("Operation failed:", safeDiagnostic(e));
    process.exit(1);
  }
})();
