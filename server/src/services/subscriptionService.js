import Tenant from "../models/Tenant.js";

export function addSubscriptionMonths(fromDate, months = 1) {
  const safeMonths = Math.min(24, Math.max(1, Number(months) || 1));
  const base = new Date(fromDate || Date.now());
  const result = new Date(base);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + safeMonths);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

export async function expireDueSubscriptions(now = new Date()) {
  const result = await Tenant.updateMany(
    {
      status: { $in: ["active", "suspended"] },
      "subscription.status": { $in: ["active", "suspended"] },
      "subscription.endsAt": { $ne: null, $lte: now },
    },
    {
      $set: {
        status: "expired",
        "subscription.status": "expired",
        "subscription.expiredAt": now,
      },
    }
  );
  return result.modifiedCount || 0;
}

export function subscriptionView(tenant) {
  const subscription = tenant?.subscription || {};
  return {
    billingMode: subscription.billingMode || "manual",
    status: subscription.status || "unmanaged",
    startsAt: subscription.startsAt || null,
    endsAt: subscription.endsAt || null,
    lastPaymentAt: subscription.lastPaymentAt || null,
    lastRenewedAt: subscription.lastRenewedAt || null,
    paymentNote: subscription.paymentNote || "",
  };
}
