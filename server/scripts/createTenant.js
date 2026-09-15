if (process.env.NODE_ENV === "production") throw new Error("Development tenant setup is disabled in production. Use clinic onboarding.");
import "dotenv/config";
import mongoose from "mongoose";
import Tenant from "../src/models/Tenant.js";

const [slugArg, ...nameParts] = process.argv.slice(2);
const slug = String(slugArg || "").trim().toLowerCase();
const name = nameParts.join(" ").trim() || slug;
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error("Usage: npm run tenant:create -- clinic-b Clinic B");
  process.exit(1);
}
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
await mongoose.connect(process.env.MONGO_URI);
try {
  const tenant = await Tenant.findOneAndUpdate({ slug }, { $setOnInsert: { slug, name, status: "active" } }, { upsert: true, new: true, runValidators: true });
  console.log(`Tenant ready: ${tenant.name} (${tenant.slug})`);
} finally { await mongoose.disconnect(); }
