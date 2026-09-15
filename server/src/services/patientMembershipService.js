import Patient from "../models/Patient.js";
import GlobalPatient from "../models/GlobalPatient.js";
import { runWithTenant } from "./tenantExecutionContext.js";

function globalProfilePatch(globalPatient) {
  return {
    name: globalPatient.name || "",
    phone: globalPatient.phone || undefined,
    dateOfBirth: globalPatient.dateOfBirth || null,
    gender: globalPatient.gender || "",
    bloodGroup: globalPatient.bloodGroup || "",
    allergies: Array.isArray(globalPatient.allergies) ? globalPatient.allergies : [],
    medicalHistory: Array.isArray(globalPatient.medicalHistory) ? globalPatient.medicalHistory : [],
    currentMedications: Array.isArray(globalPatient.currentMedications) ? globalPatient.currentMedications : [],
    pastSurgeries: Array.isArray(globalPatient.pastSurgeries) ? globalPatient.pastSurgeries : [],
    emergencyContact: {
      name: globalPatient.emergencyContact?.name || "",
      phone: globalPatient.emergencyContact?.phone || "",
    },
    profileCompleted: Boolean(globalPatient.profileCompleted),
  };
}

async function promoteLegacyClinicProfile(globalPatient, patient) {
  if (globalPatient.profileCompleted || !patient?.profileCompleted ||
      !["verified_global_registration", "clinic_verified_claim"].includes(patient.identityLink?.method)) return globalPatient;

  const patch = {
    name: patient.name || globalPatient.name || "",
    phone: patient.phone || globalPatient.phone || "",
    dateOfBirth: patient.dateOfBirth || null, gender: patient.gender || "",
    bloodGroup: patient.bloodGroup || "",
    allergies: patient.allergies || [], medicalHistory: patient.medicalHistory || [],
    currentMedications: patient.currentMedications || [], pastSurgeries: patient.pastSurgeries || [],
    emergencyContact: patient.emergencyContact || { name: "", phone: "" },
    profileCompleted: true, profileUpdatedAt: new Date(),
  };
  const updated = await GlobalPatient.findOneAndUpdate({
    _id: globalPatient._id, status: "active", tokenVersion: globalPatient.tokenVersion,
    profileCompleted: false,
  }, { $set: patch, $inc: { privacyRevision: 1 } }, { new: true, runValidators: true });
  if (!updated) {
    throw Object.assign(new Error("Global profile changed. Refresh and try again."), { status: 409 });
  }
  Object.assign(globalPatient, patch);
  return globalPatient;
}

export async function resolvePatientMembership({ tenantId, globalPatient }) {
  if (!tenantId || !globalPatient?._id) return null;
  if (globalPatient.status !== "active") {
    throw Object.assign(new Error("Patient account is unavailable."), { status: 401 });
  }

  return runWithTenant(tenantId, async () => {
    let patient = await Patient.findOne({ globalPatientId: globalPatient._id });

    // A contact email is not proof of ownership of a legacy medical record.
    // Never claim an unlinked walk-in record merely because its email matches.
    if (!patient && globalPatient.email) {
      const legacy = await Patient.findOne({ email: globalPatient.email })
        .select("_id globalPatientId").lean();
      if (legacy) {
        throw Object.assign(new Error("An existing clinic record needs identity verification. Contact the clinic reception or privacy support to link it safely."), {
          status: 409, code: "PATIENT_IDENTITY_REVIEW_REQUIRED",
        });
      }
    }

    // Existing Day-6 users should not be forced to retype a completed clinic
    // profile. The first linked completed legacy profile can seed the global one.
    if (patient) {
      // Historical links predate identity provenance. Preserve their clinic records,
      // but do not silently copy or overwrite health data until ownership is reviewed.
      if (!["verified_global_registration", "clinic_verified_claim"].includes(patient.identityLink?.method)) {
        return patient;
      }
      await promoteLegacyClinicProfile(globalPatient, patient);
      Object.assign(patient, globalProfilePatch(globalPatient));
      await patient.save();
      return patient;
    }

    try {
      return await Patient.create({
        tenantId,
        globalPatientId: globalPatient._id,
        identityLink: { method: "verified_global_registration", linkedAt: new Date() },
        email: globalPatient.email,
        ...globalProfilePatch(globalPatient),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      patient = await Patient.findOne({ globalPatientId: globalPatient._id });
      if (!patient) {
        throw Object.assign(new Error("An existing clinic record needs identity verification. Contact the clinic reception or privacy support to link it safely."), {
          status: 409, code: "PATIENT_IDENTITY_REVIEW_REQUIRED",
        });
      }
      if (!["verified_global_registration", "clinic_verified_claim"].includes(patient.identityLink?.method)) return patient;
      Object.assign(patient, globalProfilePatch(globalPatient));
      await patient.save();
      return patient;
    }
  });
}

export async function syncGlobalProfileToMembership({ tenantId, globalPatient }) {
  return resolvePatientMembership({ tenantId, globalPatient });
}
