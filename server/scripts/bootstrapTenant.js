import dotenv from "dotenv";
import mongoose from "mongoose";
import Tenant from "../src/models/Tenant.js";

dotenv.config();
if (process.env.NODE_ENV === "production") throw new Error("Development tenant setup is disabled in production. Use clinic onboarding.");

const normalizeSlug = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function main() {
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  const name = String(process.env.DEFAULT_TENANT_NAME || "Demo Clinic").trim();
  const slug = normalizeSlug(process.env.DEFAULT_TENANT_SLUG || "demo-clinic");

  if (!mongoUri) throw new Error("MONGO_URI is required.");
  if (!name) throw new Error("DEFAULT_TENANT_NAME is required.");
  if (!slug) throw new Error("DEFAULT_TENANT_SLUG is invalid.");

  await mongoose.connect(mongoUri);

  const tenant = await Tenant.findOneAndUpdate(
    { slug },
    {
      $setOnInsert: { name, slug, status: "active" },
    },
    { upsert: true, new: true, runValidators: true }
  );

  console.log(`Tenant ready: ${tenant.name} (${tenant.slug})`);
}

main()
  .catch((error) => {
    console.error("Tenant bootstrap failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
