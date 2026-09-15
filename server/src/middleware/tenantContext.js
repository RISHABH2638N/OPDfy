import { safeDiagnostic } from "../utils/privacySafeLog.js";
import Tenant from "../models/Tenant.js";
import { runWithTenant } from "../services/tenantExecutionContext.js";

export function normalizeTenantSlug(value) {
  return String(value || "").trim().toLowerCase();
}

export async function tenantContext(req, res, next) {
  try {
    const explicitLoginClinic = req.path === "/auth/login" ? req.body?.clinicSlug : "";
    const requestedSlug = normalizeTenantSlug(
      explicitLoginClinic ||
      req.headers["x-clinic-slug"] ||
      req.query?.clinic ||
      req.body?.clinicSlug ||
      (process.env.NODE_ENV === "production" ? "" : process.env.DEFAULT_TENANT_SLUG)
    );

    if (!requestedSlug) {
      return res.status(400).json({ message: "Clinic context is required." });
    }

    const tenant = await Tenant.findOne({ slug: requestedSlug })
      .select("_id name slug status timezone settings subscription")
      .lean();

    if (!tenant) {
      return res.status(404).json({ message: "Clinic not found." });
    }

    const subscriptionEnd = tenant.subscription?.endsAt ? new Date(tenant.subscription.endsAt) : null;
    if (["active", "suspended"].includes(tenant.status) && ["active", "suspended"].includes(tenant.subscription?.status) && subscriptionEnd && subscriptionEnd <= new Date()) {
      await Tenant.updateOne(
        { _id: tenant._id, status: "active", "subscription.status": "active" },
        { $set: { status: "expired", "subscription.status": "expired", "subscription.expiredAt": new Date() } }
      );
      tenant.status = "expired";
    }

    if (tenant.status !== "active") {
      return res.status(403).json({ message: "Clinic is currently unavailable." });
    }

    req.tenant = tenant;
    req.tenantId = tenant._id;
    return runWithTenant(tenant._id, () => next());
  } catch (error) {
    console.error("Tenant context error:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to resolve clinic." });
  }
}
