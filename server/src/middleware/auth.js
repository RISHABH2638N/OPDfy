import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { normalizeDepartment } from "../utils/departments.js";
import { logSecurityEvent } from "../utils/securityEvents.js";

const STAFF_ROLES = ["doctor", "admin", "receptionist"];

export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const decoded = verifySessionToken(header.slice(7), process.env.JWT_SECRET);

    // Do not allow a patient/QR JWT signed with the same application secret
    // to enter staff-only middleware.
    if (
      !decoded?.id ||
      !mongoose.Types.ObjectId.isValid(decoded.id) ||
      !STAFF_ROLES.includes(decoded.role) ||
      !decoded.tenantId ||
      decoded.tenantId !== req.tenantId?.toString()
    ) {
      return res.status(401).json({ message: "Invalid staff session." });
    }

    // Re-read the account on every protected request so deletion or a role /
    // department change takes effect immediately instead of waiting for JWT expiry.
    const user = await User.findOne({ _id: decoded.id, tenantId: req.tenantId })
      .select("_id name email role department tenantId prescriptionProfile +tokenVersion")
      .lean();

    if (!user || !STAFF_ROLES.includes(user.role) || Number(decoded.ver || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({
        message: "Staff account no longer exists or has been disabled.",
      });
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      department: normalizeDepartment(user.department),
      tenantId: user.tenantId.toString(),
      clinicSlug: req.tenant.slug,
      prescriptionProfile: user.prescriptionProfile || {},
    };

    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    if (["JsonWebTokenError", "NotBeforeError", "CastError"].includes(error?.name)) {
      return res.status(401).json({ message: "Invalid staff session." });
    }

    console.error("Staff authentication error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to authenticate staff account." });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      logSecurityEvent(req, {
        event: "authorization_denied",
        outcome: "blocked",
        actorType: req.user ? "staff" : "anonymous",
        actorId: req.user?.id || "",
        tenantId: req.tenantId,
        metadata: { role: req.user?.role || "none" },
      });
      return res.status(403).json({ message: "You do not have permission." });
    }
    next();
  };
}
