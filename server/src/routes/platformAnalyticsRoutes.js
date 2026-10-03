import crypto from "node:crypto";
import mongoose from "mongoose";
import { asyncRouter } from "../utils/httpSafety.js";
import { protectSuperAdmin } from "../middleware/platformAuth.js";
import Tenant from "../models/Tenant.js";
import SubscriptionInvoice from "../models/SubscriptionInvoice.js";
import PlatformSetting from "../models/PlatformSetting.js";
import { subscriptionInvoicePdf, subscriptionInvoiceNumber } from "../services/subscriptionInvoicePdf.js";
import { buildPlatformAnalytics, validDate, badRequest } from "../services/platformAnalytics.js";
import { logSecurityEvent } from "../utils/securityEvents.js";

const router = asyncRouter();
router.use(protectSuperAdmin, (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const plans = ["Starter", "Growth", "Enterprise", "Custom"];
const methods = ["cash", "upi", "card", "bank_transfer", "other"];
async function clinic(id) {
  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) throw badRequest("Invalid clinic identifier.");
  const row = await Tenant.findById(id).select("_id").lean();
  if (!row) throw Object.assign(new Error("Clinic not found."), { status: 404 });
  return row;
}
function audit(req, event, tenantId) {
  logSecurityEvent(req, { event, outcome: "success", actorType: "superadmin", actorId: req.superAdmin.id, tenantId });
}
router.get("/analytics", async (req, res) => res.json(await buildPlatformAnalytics(req.query)));
router.get("/subscription-invoices", async (req, res) => {
  await clinic(req.query.clinicId);
  const { billingCycle, status, before } = req.query;
  if ((billingCycle != null && !["monthly", "yearly", "setup"].includes(billingCycle)) || (status != null && !["pending", "paid", "void"].includes(status))
    || (before != null && (typeof before !== "string" || !/^[a-f\d]{24}$/i.test(before)))) throw badRequest("Choose valid invoice filters.");
  const rows = await SubscriptionInvoice.find({ tenantId: req.query.clinicId, ...(billingCycle ? { billingCycle } : {}), ...(status ? { status } : {}), ...(before ? { _id: { $lt: before } } : {}) })
    .select("_id plan billingCycle amountPaise dueDate status paidAt method createdAt").sort({ _id: -1 }).limit(51).lean();
  const hasMore = rows.length > 50;
  res.json({ invoices: rows.slice(0, 50), nextCursor: hasMore ? String(rows[49]._id) : null });
});
router.get("/subscription-invoices/:id/pdf", async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw badRequest("Invalid invoice identifier.");
  const invoice = await SubscriptionInvoice.findById(req.params.id).lean();
  if (!invoice) return res.status(404).json({ message: "Invoice not found." });
  const buyer = await Tenant.findById(invoice.tenantId).select("name contactEmail contactPhone legalVerification.legalName settings.branding.address").lean();
  if (!buyer) return res.status(404).json({ message: "Clinic not found." });
  const branding = await PlatformSetting.findOne({ key: "branding" }).select("productName").lean();
  const buffer = await subscriptionInvoicePdf(invoice, buyer, branding?.productName || "OPDfy");
  audit(req, "platform_subscription_invoice_download", invoice.tenantId);
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${subscriptionInvoiceNumber(invoice._id)}.pdf"` }).send(buffer);
});
router.put("/clinics/:id/analytics-terms", async (req, res) => {
  await clinic(req.params.id);
  const { plan, billingCycle, feePaise, pilotEndDate } = req.body || {};
  if (!plans.includes(plan) || !["monthly", "yearly"].includes(billingCycle) || !Number.isSafeInteger(feePaise) || feePaise < 1 || feePaise > 100000000) throw badRequest("Enter valid subscription terms.");
  if (pilotEndDate && !validDate(pilotEndDate)) throw badRequest("Enter a valid pilot end date.");
  const terms = { plan, billingCycle, feePaise, pilotEndsAt: pilotEndDate ? new Date(`${pilotEndDate}T23:59:59.999+05:30`) : null };
  await Tenant.updateOne({ _id: req.params.id }, { $set: { analyticsTerms: terms } }, { runValidators: true });
  audit(req, "platform_subscription_terms", req.params.id);
  res.json({ message: "Subscription terms saved.", terms });
});
router.post("/subscription-invoices", async (req, res) => {
  const body = req.body || {};
  await clinic(body.clinicId);
  if (!plans.includes(body.plan) || !["monthly", "yearly", "setup"].includes(body.billingCycle) || !Number.isSafeInteger(body.amountPaise) || body.amountPaise < 1 || body.amountPaise > 100000000 || !validDate(body.dueDate)
    || !["pending", "paid"].includes(body.status) || typeof body.requestId !== "string" || !/^[a-f\d-]{36}$/i.test(body.requestId)) throw badRequest("Enter valid invoice details.");
  if (body.status === "paid" && (!methods.includes(body.method) || !validDate(body.paidDate) || new Date(`${body.paidDate}T00:00:00+05:30`) > new Date())) throw badRequest("Enter a valid payment method and payment date.");
  const payload = { tenantId: body.clinicId.toLowerCase(), plan: body.plan, billingCycle: body.billingCycle, amountPaise: body.amountPaise, dueDate: body.dueDate, status: body.status,
    method: body.status === "paid" ? body.method : "", paidAt: body.status === "paid" ? new Date(`${body.paidDate}T00:00:00+05:30`) : null };
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  let invoice;
  try { invoice = await SubscriptionInvoice.create({ ...payload, requestId: body.requestId, fingerprint, createdBy: req.superAdmin.id, settledBy: payload.status === "paid" ? req.superAdmin.id : null }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await SubscriptionInvoice.findOne({ requestId: body.requestId });
    if (!existing || existing.fingerprint !== fingerprint) throw Object.assign(new Error("This invoice request has already been used with different details."), { status: 409 });
    return res.json({ message: "Invoice already recorded.", id: existing.id });
  }
  audit(req, "platform_subscription_invoice", body.clinicId);
  res.status(201).json({ message: "Subscription invoice recorded.", id: invoice.id });
});
router.patch("/subscription-invoices/:id", async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw badRequest("Invalid invoice identifier.");
  const { status, method, paidDate } = req.body || {};
  if (!["paid", "void"].includes(status)) throw badRequest("Choose paid or void for a pending invoice.");
  if (status === "paid" && (!methods.includes(method) || !validDate(paidDate) || new Date(`${paidDate}T00:00:00+05:30`) > new Date())) throw badRequest("Enter a valid payment method and payment date.");
  const invoice = await SubscriptionInvoice.findOneAndUpdate({ _id: req.params.id, status: "pending" }, { $set: {
    status, method: status === "paid" ? method : "", paidAt: status === "paid" ? new Date(`${paidDate}T00:00:00+05:30`) : null, settledBy: req.superAdmin.id,
  } }, { new: true, runValidators: true });
  if (!invoice) return res.status(409).json({ message: "Invoice is unavailable or already settled. Refresh the ledger." });
  audit(req, "platform_subscription_settled", invoice.tenantId);
  res.json({ message: status === "paid" ? "Payment recorded." : "Invoice voided." });
});
export default router;
