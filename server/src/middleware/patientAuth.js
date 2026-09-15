import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { publicErrorMessage } from "../utils/httpSafety.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import jwt from "jsonwebtoken";
import GlobalPatient from "../models/GlobalPatient.js";
import { resolvePatientMembership } from "../services/patientMembershipService.js";

export async function protectPatient(req, res, next) {
  try {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Patient authentication required." });
    }

    const decoded = verifySessionToken(header.slice(7), process.env.JWT_SECRET);
    if (decoded?.role !== "patient-global" || !decoded?.id) {
      return res.status(403).json({ message: "This account is not a global patient account." });
    }

    const globalPatient = await GlobalPatient.findOne({ _id: decoded.id, status: "active" }).select("+tokenVersion");
    if (!globalPatient || Number(decoded.ver || 0) !== Number(globalPatient.tokenVersion || 0)) {
      return res.status(401).json({ message: "Patient account no longer exists." });
    }

    const patient = await resolvePatientMembership({
      tenantId: req.tenantId,
      globalPatient,
    });
    if (!patient) return res.status(500).json({ message: "Unable to resolve clinic patient profile." });

    req.globalPatient = globalPatient;
    req.patient = patient;
    req.patientIdentityReviewRequired = !["verified_global_registration", "clinic_verified_claim"].includes(patient.identityLink?.method);
    req.patientAuth = {
      id: String(patient._id),
      patientId: patient.patientId,
      globalPatientId: String(globalPatient._id),
      role: "patient-global",
      tenantId: String(req.tenantId),
      clinicSlug: req.tenant.slug,
    };

    next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Patient session expired. Please login again." });
    }
    if (["JsonWebTokenError", "NotBeforeError", "CastError"].includes(error?.name)) {
      return res.status(401).json({ message: "Invalid patient session." });
    }
    console.error("Patient authentication error:", safeDiagnostic(error));
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to authenticate patient.") });
  }
}
