import Tenant from "../models/Tenant.js";

export async function ensureDefaultTenant() {
  const slug = String(process.env.DEFAULT_TENANT_SLUG || "demo-clinic").trim().toLowerCase();
  const name = String(process.env.DEFAULT_TENANT_NAME || "Demo Clinic").trim();

  return Tenant.findOneAndUpdate(
    { slug },
    {
      $setOnInsert: {
        name,
        slug,
        status: "active",
        timezone: process.env.HOSPITAL_TIMEZONE || "Asia/Kolkata",
        settings: { displayName: name, defaultDepartment: "General OPD" },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
