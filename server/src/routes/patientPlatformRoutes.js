import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import mongoose from "mongoose";
import Tenant from "../models/Tenant.js";
import { protectGlobalPatient } from "../middleware/globalPatientAuth.js";
import { expireDueSubscriptions } from "../services/subscriptionService.js";
import { publicClinicVerification, publicDoctorVerification } from "../utils/legalVerification.js";

const router = asyncRouter();

function publicSchedule(schedule = {}) {
  return {
    workingDays: Array.isArray(schedule.workingDays) ? schedule.workingDays : [],
    startTime: schedule.startTime || "09:00",
    endTime: schedule.endTime || "17:00",
    roomNumber: schedule.roomNumber || "",
    isOnBreak: Boolean(schedule.isOnBreak),
  };
}

async function rosterForTenant(tenantId) {
  const db = mongoose.connection.db;
  return db.collection("users")
    .find({ tenantId, role: "doctor" })
    .project({ name: 1, department: 1, doctorSchedule: 1, professionalVerification: 1 })
    .sort({ department: 1, name: 1 })
    .toArray();
}

router.get("/clinics", protectGlobalPatient, async (req, res) => {
  try {
    await expireDueSubscriptions();
    const search = String(req.query?.q || "").trim();
    const filter = { status: "active" };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { slug: { $regex: escaped, $options: "i" } },
      ];
    }

    const tenants = await Tenant.find(filter)
      .select("_id name slug contactEmail contactPhone timezone settings legalVerification createdAt")
      .sort({ name: 1 })
      .lean();

    const clinics = await Promise.all(tenants.map(async (tenant) => {
      const doctors = await rosterForTenant(tenant._id);
      const departments = [...new Set(doctors.map((d) => d.department).filter(Boolean))];
      return {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        contactEmail: tenant.contactEmail || "",
        contactPhone: tenant.contactPhone || "",
        timezone: tenant.timezone,
        displayName: tenant.settings?.displayName || tenant.name,
        defaultDepartment: tenant.settings?.defaultDepartment || "General OPD",
        branding: tenant.settings?.branding || {},
        doctorCount: doctors.length,
        departments,
        legalVerification: publicClinicVerification(tenant.legalVerification || {}),
      };
    }));

    res.json({ clinics, count: clinics.length });
  } catch (error) {
    console.error("Patient clinic discovery error:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to load clinics." });
  }
});

router.get("/clinics/:slug", protectGlobalPatient, async (req, res) => {
  try {
    await expireDueSubscriptions();
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const tenant = await Tenant.findOne({ slug, status: "active" })
      .select("_id name slug contactEmail contactPhone timezone settings legalVerification")
      .lean();
    if (!tenant) return res.status(404).json({ message: "Clinic not found or unavailable." });

    const doctors = await rosterForTenant(tenant._id);
    res.json({
      clinic: {
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        contactEmail: tenant.contactEmail || "",
        contactPhone: tenant.contactPhone || "",
        timezone: tenant.timezone,
        displayName: tenant.settings?.displayName || tenant.name,
        defaultDepartment: tenant.settings?.defaultDepartment || "General OPD",
        branding: tenant.settings?.branding || {},
        legalVerification: publicClinicVerification(tenant.legalVerification || {}),
      },
      doctors: doctors.map((doctor) => ({
        id: doctor._id,
        name: doctor.name,
        department: doctor.department || "General OPD",
        schedule: publicSchedule(doctor.doctorSchedule),
        professionalVerification: publicDoctorVerification(doctor.professionalVerification || {}),
      })),
    });
  } catch (error) {
    console.error("Patient clinic detail error:", safeDiagnostic(error));
    res.status(500).json({ message: "Unable to load clinic details." });
  }
});

export default router;
