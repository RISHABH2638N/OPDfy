import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import jwt from "jsonwebtoken";
import GlobalPatient from "../models/GlobalPatient.js";

export async function protectGlobalPatient(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Patient authentication required." });
    }

    const token = header.slice(7);
    const decoded = verifySessionToken(token, process.env.JWT_SECRET);

    if (decoded?.role !== "patient-global" || !decoded?.id) {
      return res.status(403).json({ message: "This account is not a global patient account." });
    }

    const patient = await GlobalPatient.findOne({ _id: decoded.id, status: "active" }).select("+tokenVersion");
    if (!patient || Number(decoded.ver || 0) !== Number(patient.tokenVersion || 0)) {
      return res.status(401).json({ message: "Patient account no longer exists." });
    }

    req.globalPatient = patient;
    req.globalPatientAuth = {
      id: String(patient._id),
      role: "patient-global",
      email: patient.email,
    };
    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Patient session expired. Please login again." });
    }
    if (["JsonWebTokenError", "NotBeforeError", "CastError"].includes(error?.name)) {
      return res.status(401).json({ message: "Invalid patient session." });
    }
    console.error("Global patient authentication error:", safeDiagnostic(error));
    return res.status(500).json({ message: "Unable to authenticate patient." });
  }
}
