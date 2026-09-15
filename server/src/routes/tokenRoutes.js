import { safeDiagnostic } from "../utils/privacySafeLog.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import mongoose from "mongoose";
import express from "express";
import Token from "../models/Token.js";
import Patient from "../models/Patient.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Tenant from "../models/Tenant.js";
import { DEPARTMENTS, normalizeDepartment } from "../utils/departments.js";
import { getDoctorAvailability, onlyAvailableDoctors } from "../utils/doctorAvailability.js";
import { getTokenWaitEstimate } from "../utils/waitTime.js";
import {
  processQueueNotifications,
  notifyTokenCalled,
  notifyConsultationCompleted,
} from "../services/notificationService.js";
import {protect,requireRole} from "../middleware/auth.js";
import { syncAppointmentFromToken } from "../services/appointmentLifecycleService.js";
import {
  emitOperationalUpdate,
  emitQueueUpdate,
  emitPatientTokenUpdate,
} from "../services/realtimeService.js";
import { getClinicOperations, hospitalLocalDateTime } from "../utils/clinicOperations.js";

const router=asyncRouter();

const PUBLIC_QUEUE_FIELDS = "tokenNumber department status urgency assignedDoctor calledAt queueControl.isOnHold -_id";

async function getPublicQueue() {
  const rows = await Token.find({ isArchived: { $ne: true } })
    .select(PUBLIC_QUEUE_FIELDS)
    .populate({ path: "assignedDoctor", select: "name doctorSchedule -_id" })
    .sort({ department: 1, tokenNumber: 1 })
    .lean();

  // Waiting-lounge feed remains privacy-safe: no patient identity or database IDs.
  // Doctor display name and room are operational location information only.
  return rows.map((item) => ({
    tokenNumber: item.tokenNumber,
    department: item.department,
    status: item.queueControl?.isOnHold ? "held" : item.status,
    urgency: item.urgency,
    calledAt: item.calledAt || null,
    doctorName: item.assignedDoctor?.name || "",
    roomNumber: item.assignedDoctor?.doctorSchedule?.roomNumber || "",
  }));
}

async function broadcast(req, extraDomains = []) {
  const io = req.app.get("io");
  if (!io) return;

  // Keep the privacy-safe public feed, but never make doctor/reception
  // actions wait for notification fan-out/email work.
  emitQueueUpdate(io, await getPublicQueue());
  emitOperationalUpdate(io, ["queue", "analytics", ...extraDomains]);
  processQueueNotifications(io).catch((error) => {
    console.error("Queue notification processing failed:", safeDiagnostic(error));
  });
}


router.get("/doctors", async (req, res) => {
  try {
    const department = normalizeDepartment(req.query.department || "General OPD");
    if (!DEPARTMENTS.includes(department)) {
      return res.status(400).json({ message: "Invalid department." });
    }
    const doctors = await User.find({ role: "doctor", department })
      .select("_id name department doctorSchedule")
      .sort({ name: 1 })
      .lean();
    return res.json({ doctors: onlyAvailableDoctors(doctors) });
  } catch (e) {
    return res.status(500).json({ message: "Unable to load doctor roster." });
  }
});

router.get("/",async(req,res)=>{
  try{
    // Public waiting-room/kiosk feed: intentionally excludes all patient PII,
    // database identifiers, appointment links and assigned-doctor identifiers.
    res.json(await getPublicQueue());
  }
  catch(e){res.status(500).json({message:"Unable to fetch queue."});}
});

router.get("/private", protect, requireRole("doctor","admin","receptionist"), async(req,res)=>{
  try{
    const filter={isArchived:{$ne:true}};

    // Doctors only need their own workstation queue. Admin/reception retain
    // the full operational queue required for hospital workflows.
    if(req.user.role==="doctor"){
      filter.assignedDoctor=req.user.id;
      filter.department=normalizeDepartment(req.user.department);
      filter["queueControl.isOnHold"]={$ne:true};
    }

    const tokens=await Token.find(filter)
      .sort({department:1, tokenNumber:1})
      .lean();

    res.json(tokens);
  }
  catch(e){res.status(500).json({message:"Unable to fetch private queue."});}
});

router.post("/", (req, res) => {
  return res.status(403).json({
    message:
      "Anonymous token issuance is disabled for security. Please sign in as a patient or visit reception.",
  });
});

router.get("/:id/eta", protect, requireRole("doctor", "admin", "receptionist"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid token ID.",
      });
    }

    const token =
      await Token.findById(
        req.params.id
      ).lean();

    if (!token) {
      return res.status(404).json({
        message: "Token not found.",
      });
    }

    if (req.user.role === "doctor" && String(token.assignedDoctor || "") !== req.user.id) {
      return res.status(403).json({ message: "This patient is not assigned to you." });
    }

    const eta =
      await getTokenWaitEstimate(
        token
      );

    return res.json({
      eta,
    });
  } catch (error) {
    console.error(
      "TOKEN ETA:",
      safeDiagnostic(error)
    );

    return res.status(500).json({
      message:
        "Unable to calculate live waiting time.",
    });
  }
});

router.get("/stats",async(req,res)=>{
  try{
    const [counts,avg]=await Promise.all([
      Token.aggregate([{$match:{isArchived:{$ne:true}}},{$group:{_id:"$status",count:{$sum:1}}}]),
      Token.aggregate([
        {$match:{isArchived:{$ne:true},status:"completed",calledAt:{$ne:null},completedAt:{$ne:null}}},
        {$project:{m:{$divide:[{$subtract:["$completedAt","$calledAt"]},60000]}}},
        {$match:{m:{$gte:0,$lte:180}}},
        {$group:{_id:null,averageMinutes:{$avg:"$m"},completedPatients:{$sum:1}}}
      ])
    ]);
    const stats={waiting:0,called:0,completed:0,skipped:0,total:0};
    counts.forEach(x=>{stats[x._id]=x.count;stats.total+=x.count});
    stats.averageMinutes=Number((avg[0]?.averageMinutes??7).toFixed(1));
    stats.completedPatients=avg[0]?.completedPatients??0;
    res.json(stats);
  }catch(e){res.status(500).json({message:"Unable to calculate statistics."});}
});


router.get("/doctor/appointments/today", protect, requireRole("doctor"), async (req,res)=>{
  try{
    const doctorId=req.user.role==="doctor"?req.user.id:String(req.query.doctorId||"");
    if(!doctorId)return res.status(400).json({message:"Doctor is required."});
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:process.env.HOSPITAL_TIMEZONE||"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const appointments=await Appointment.find({doctor:doctorId,appointmentDate:date,status:{$ne:"cancelled"}})
      .sort({startTime:1}).lean();
    res.json({date,appointments});
  }catch(error){res.status(500).json({message:"Unable to load today's appointments."});}
});

router.patch("/:id/status",protect,requireRole("doctor"),async(req,res)=>{
  try{
    const {status}=req.body;
    if(!["waiting","called","completed","skipped"].includes(status))
      return res.status(400).json({message:"Invalid token status."});

    const token=await Token.findById(req.params.id);
    if(!token)return res.status(404).json({message:"Token not found."});

    if (token.isArchived) return res.status(409).json({message:"Archived visits cannot be changed."});
    const isDoctor=req.user.role === "doctor";
    const doctorDepartment=normalizeDepartment(req.user.department);

    if (isDoctor && token.queueControl?.isOnHold) {
      return res.status(409).json({ message: "Reception has placed this token on hold. Resume it at the front desk before doctor action." });
    }

    if(isDoctor && token.department !== doctorDepartment) {
      return res.status(403).json({
        message:`This patient belongs to ${token.department}. Your assigned specialty is ${doctorDepartment}.`,
      });
    }

    if(status==="called"){
      if(token.status !== "waiting") {
        return res.status(400).json({message:"Only a waiting patient can be called."});
      }

      if(isDoctor){
        const doctorAccount = await User.findById(req.user.id)
          .select("name doctorSchedule")
          .lean();

        const availability = getDoctorAvailability(doctorAccount);
        if (!availability.isAvailable) {
          return res.status(409).json({
            message: availability.reason,
            availability,
          });
        }

        if(!token.assignedDoctor) {
          return res.status(409).json({message:"This patient has not been assigned to your workstation. Ask reception to assign the token first."});
        }
        if(token.assignedDoctor.toString() !== req.user.id.toString()) {
          return res.status(409).json({message:"This patient is assigned to another doctor."});
        }

        const existing=await Token.findOne({
          assignedDoctor:req.user.id,
          status:"called",
          _id:{$ne:token._id},
        });
        if(existing)return res.status(409).json({message:`You are already serving token #${existing.tokenNumber}. Complete or skip it before calling another patient.`});

        token.assignedDoctor=req.user.id;
      }

      token.calledAt=new Date();
      token.completedAt=null;
    }

    if(status==="completed" || status==="skipped"){
      if(token.status!=="called")return res.status(400).json({message:"Only a called patient can be completed or skipped."});

      if(isDoctor && token.assignedDoctor && token.assignedDoctor.toString() !== req.user.id.toString()) {
        return res.status(403).json({message:"This patient is assigned to another doctor."});
      }

      if(isDoctor && !token.assignedDoctor) {
        token.assignedDoctor=req.user.id;
      }

      if(status==="completed") {
        token.completedAt=new Date();
      }
      if(status==="skipped") token.completedAt=null;
    }

    if(status==="waiting"){
      if (token.status !== "called") return res.status(409).json({message:"Only a called patient can return to waiting. Contact reception to recover a skipped visit."});
      if(isDoctor && token.assignedDoctor && token.assignedDoctor.toString() !== req.user.id.toString()) {
        return res.status(403).json({message:"This patient is assigned to another doctor."});
      }
      // Scheduled visits remain locked to their booked doctor if an admin
      // returns a called token to waiting. Walk-ins may be explicitly
      // reassigned at reception.
      if (
        !token.appointment &&
        !token.reservation &&
        !["appointment", "reservation"].includes(token.queueSource)
      ) {
        token.assignedDoctor=null;
      }
      token.calledAt=null;
      token.completedAt=null;
    }

    token.status=status;
    await token.save();

    const io = req.app.get("io");
    if (token.patient) {
      emitPatientTokenUpdate(io, token.patient, token);
    }

    // Keep the scheduled visit lifecycle aligned with its live queue token.
    // In particular, a doctor skip must not leave the appointment stuck in
    // `checked_in`, otherwise same-day rebooking stays incorrectly blocked.
    const linkedAppointment = await syncAppointmentFromToken(token);

    // Broadcast first so operational dashboards update immediately even if
    // email delivery or notification processing is temporarily slow.
    await broadcast(req, linkedAppointment ? ["appointments"] : []);

    res.json(token);

    // Notification delivery is a side effect. Do not hold the doctor's
    // button response open while SMTP/notification work completes.
    if (status === "called") {
      notifyTokenCalled(token, io).catch((error) => {
        console.error("Token called notification failed:", safeDiagnostic(error));
      });
    }

    if (status === "completed") {
      notifyConsultationCompleted(token, io).catch((error) => {
        console.error("Consultation completed notification failed:", safeDiagnostic(error));
      });
    }
  }catch(e){
    console.error("Operation failed:", safeDiagnostic(e));
    const statusCode = Number(e?.status || 500);
    res.status(statusCode >= 400 && statusCode < 500 ? statusCode : 500).json({
      message:
        statusCode >= 400 && statusCode < 500
          ? e.message
          : "Unable to update token status.",
    });
  }
});

router.post("/reset",protect,requireRole("admin"),async(req,res)=>{
  try{
    const unresolvedAppointmentTokens = await Token.find({
      isArchived: { $ne: true },
      appointment: { $ne: null },
      status: { $in: ["waiting", "called"] },
    }).select("appointment").lean();

    const appointmentIds = [
      ...new Set(
        unresolvedAppointmentTokens
          .map((item) => item.appointment && String(item.appointment))
          .filter(Boolean)
      ),
    ];

    if (appointmentIds.length) {
      await Appointment.updateMany(
        { _id: { $in: appointmentIds }, status: { $ne: "cancelled" } },
        { $set: { status: "skipped" } }
      );
    }

    // A daily reset closes unresolved active queue work instead of archiving it
    // while it still says waiting/called in visit history.
    await Token.updateMany(
      { isArchived: { $ne: true }, status: { $in: ["waiting", "called"] } },
      { $set: { status: "skipped", completedAt: null } }
    );

    await Token.updateMany(
      { isArchived: { $ne: true } },
      { $set: { isArchived: true } }
    );

    const tenant = await Tenant.findById(req.tenantId);
    if (tenant) {
      const current = getClinicOperations(tenant);
      const local = hospitalLocalDateTime(tenant);
      tenant.settings = tenant.settings || {};
      tenant.settings.operations = {
        ...current,
        queueState: "closed",
        queueStateDate: local.date,
        queueClosedAt: new Date(),
        queueClosedReason: String(req.body?.reason || "End-of-day queue archived.").trim().slice(0, 240),
      };
      await tenant.save();
    }

    await broadcast(req, appointmentIds.length ? ["appointments", "settings"] : ["settings"]);
    res.json({message:"End of day completed. Unresolved visits were closed as skipped, the queue was archived, and new arrivals are closed for today."});
  }
  catch(e){
    console.error("QUEUE RESET:", safeDiagnostic(e));
    res.status(500).json({message:"Unable to reset queue."});
  }
});

/* =========================================================
   DOCTOR: GET PATIENT MEDICAL PROFILE FOR TOKEN

   GET /api/tokens/:id/patient-profile

   Doctor/Admin only.
========================================================= */

router.get(
  "/:id/patient-profile",
  protect,
  requireRole("doctor"),
  async (req, res) => {
    try {
      /* ---------------------------------------------------
         FIND TOKEN
      --------------------------------------------------- */
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
  return res.status(400).json({
    message: "Invalid token ID.",
  });
}
      const token =
        await Token.findById(
          req.params.id
        );

      if (!token) {
        return res.status(404).json({
          message:
            "Token not found.",
        });
      }

      if (req.user.role === "doctor") {
        if (token.status !== "called") {
          return res.status(403).json({
            message: "Patient medical profile is available only while this patient is actively called to your room.",
          });
        }

        const doctorDepartment = normalizeDepartment(req.user.department);
        if (token.department !== doctorDepartment) {
          return res.status(403).json({
            message: "This patient is outside your assigned specialty.",
          });
        }
        if (!token.assignedDoctor || token.assignedDoctor.toString() !== req.user.id.toString()) {
          return res.status(403).json({
            message: "This patient is not assigned to your workstation.",
          });
        }
      }


      /* ---------------------------------------------------
         OLD TOKEN WITHOUT PATIENT LINK
      --------------------------------------------------- */

      if (!token.patient) {
        return res.status(404).json({
          message:
            "No registered patient profile is linked to this token.",
        });
      }


      /* ---------------------------------------------------
         LOAD PATIENT
      --------------------------------------------------- */

      const patient =
        await Patient.findById(
          token.patient
        );

      if (!patient) {
        return res.status(404).json({
          message:
            "Patient profile not found.",
        });
      }


      /* ---------------------------------------------------
         RETURN ONLY THE INFORMATION NEEDED BY THE
         DOCTOR DASHBOARD
      --------------------------------------------------- */

      return res.json({
        patient: {
          id:
            patient._id,

          patientId:
            patient.patientId,

          name:
            patient.name,

          phone:
            patient.phone,

          dateOfBirth:
            patient.dateOfBirth,

          gender:
            patient.gender,

          bloodGroup:
            patient.bloodGroup,

          allergies:
            patient.allergies || [],

          medicalHistory:
            patient.medicalHistory || [],

          currentMedications:
            patient.currentMedications || [],

          pastSurgeries:
            patient.pastSurgeries || [],

          emergencyContact:
            patient.emergencyContact || {
              name: "",
              phone: "",
            },
        },

        token: {
          id:
            token._id,

          tokenNumber:
            token.tokenNumber,

          department:
            token.department,

          status:
            token.status,
        },
      });

    } catch (error) {
      console.error(
        "Doctor patient profile error:",
        safeDiagnostic(error)
      );

      return res.status(500).json({
        message:
          "Unable to load patient medical profile.",
      });
    }
  }
);

export default router;