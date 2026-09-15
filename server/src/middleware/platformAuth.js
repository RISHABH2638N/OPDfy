import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import SuperAdmin from "../models/SuperAdmin.js";

export async function protectSuperAdmin(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Platform authentication required." });
    }

    const secret = process.env.SUPER_ADMIN_JWT_SECRET;
    if (!secret) return res.status(503).json({ message: "Platform authentication is not configured." });

    const decoded = verifySessionToken(header.slice(7), secret);
    if (
      decoded?.role !== "superadmin" ||
      !decoded?.id ||
      !mongoose.Types.ObjectId.isValid(decoded.id)
    ) {
      return res.status(401).json({ message: "Invalid platform session." });
    }

    const account = await SuperAdmin.findOne({ _id: decoded.id, status: "active" })
      .select("_id name email status +tokenVersion")
      .lean();

    if (!account || Number(decoded.ver || 0) !== Number(account.tokenVersion || 0)) return res.status(401).json({ message: "Platform account is disabled or unavailable." });

    req.superAdmin = {
      id: String(account._id),
      name: account.name,
      email: account.email,
      role: "superadmin",
    };
    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Platform session expired. Please sign in again." });
    }
    if (["JsonWebTokenError", "NotBeforeError", "CastError"].includes(error?.name)) {
      return res.status(401).json({ message: "Invalid platform session." });
    }
    console.error("Platform authentication error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to authenticate platform account." });
  }
}
