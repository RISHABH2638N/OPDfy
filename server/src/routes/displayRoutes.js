import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import WaitingLoungeDisplay from "../models/WaitingLoungeDisplay.js";
import Tenant from "../models/Tenant.js";
import Token from "../models/Token.js";
import { runWithTenant } from "../services/tenantExecutionContext.js";
import { hashDisplayKey } from "../utils/displayKeyCrypto.js";

const router = asyncRouter();

const ACCESS_KEY_PATTERN = /^[a-f0-9]{48}$/i;

async function resolveDisplay(accessKey) {
  if (!ACCESS_KEY_PATTERN.test(String(accessKey || ""))) return null;

  // This is the one intentional cross-tenant lookup: the unguessable display
  // key identifies the tenant before tenant execution context exists.
  const key = String(accessKey);
  const raw = await WaitingLoungeDisplay.collection.findOne({
    isEnabled: true,
    $or: [{ accessKeyHash: hashDisplayKey(key) }, { accessKey: key }],
  });
  if (!raw) return null;
  if (raw.accessKeyExpiresAt && new Date(raw.accessKeyExpiresAt) <= new Date()) return null;

  const tenant = await Tenant.findOne({ _id: raw.tenantId, status: "active" })
    .select("_id name slug status contactEmail contactPhone settings subscription")
    .lean();
  if (!tenant) return null;

  const subscriptionEnd = tenant.subscription?.endsAt ? new Date(tenant.subscription.endsAt) : null;
  if (
    ["active", "suspended"].includes(tenant.subscription?.status) &&
    subscriptionEnd && subscriptionEnd <= new Date()
  ) {
    return null;
  }

  return { raw, tenant };
}

router.get("/:accessKey", async (req, res) => {
  res.set("Referrer-Policy", "no-referrer");
  res.set("Cache-Control", "no-store");
  try {
    const resolved = await resolveDisplay(req.params.accessKey);
    if (!resolved) {
      return res.status(404).json({ message: "Waiting lounge display link is invalid or disabled." });
    }

    const { raw, tenant } = resolved;
    return runWithTenant(String(tenant._id), async () => {
      const filter = { isArchived: { $ne: true } };
      if (raw.department && raw.department !== "All Departments") {
        filter.department = raw.department;
      }
      if (raw.doctor) {
        filter.assignedDoctor = raw.doctor;
      }

      const rows = await Token.find(filter)
        .select("tokenNumber department status urgency assignedDoctor calledAt -_id")
        .populate({ path: "assignedDoctor", select: "name doctorSchedule -_id" })
        .sort({ department: 1, tokenNumber: 1 })
        .lean();

      const queue = rows.map((item) => ({
        tokenNumber: item.tokenNumber,
        department: item.department,
        status: item.status,
        urgency: item.urgency,
        calledAt: item.calledAt || null,
        doctorName: item.assignedDoctor?.name || "",
        roomNumber: item.assignedDoctor?.doctorSchedule?.roomNumber || "",
      }));

      return res.json({
        display: {
          name: raw.name,
          department: raw.department || "All Departments",
          doctorId: raw.doctor ? String(raw.doctor) : "",
          voice: {
            enabled: raw.voice?.enabled !== false,
            language: ["en-IN", "hi-IN"].includes(raw.voice?.language) ? raw.voice.language : "en-IN",
            volume: Math.min(1, Math.max(0.2, Number(raw.voice?.volume || 1))),
          },
        },
        clinic: {
          name: tenant.settings?.displayName || tenant.name,
          slug: tenant.slug,
          contactEmail: tenant.contactEmail || "",
          contactPhone: tenant.contactPhone || "",
          branding: tenant.settings?.branding || {},
        },
        queue,
        refreshedAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    console.error("PUBLIC WAITING LOUNGE DISPLAY:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to load waiting lounge display." });
  }
});

export default router;
