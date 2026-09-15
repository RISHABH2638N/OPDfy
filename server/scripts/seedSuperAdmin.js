import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import SuperAdmin from "../src/models/SuperAdmin.js";

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing in .env");

  const email = String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  const name = String(process.env.SUPER_ADMIN_NAME || "Platform Owner").trim();

  if (!email || !password) {
    throw new Error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in server/.env before running this command.");
  }
  if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");

  await mongoose.connect(process.env.MONGO_URI);
  const passwordHash = await bcrypt.hash(password, 12);

  const account = await SuperAdmin.findOneAndUpdate(
    { email },
    { $set: { name, passwordHash, status: "active" }, $inc: { tokenVersion: 1 } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  console.log(`Super Admin ready: ${account.email}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Super Admin seed failed:", error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
