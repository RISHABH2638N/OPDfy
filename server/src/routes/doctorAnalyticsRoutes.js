import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import { protect, requireRole } from "../middleware/auth.js";
import Token from "../models/Token.js";
import Appointment from "../models/Appointment.js";
import Consultation from "../models/Consultation.js";
import FollowUpPlan from "../models/FollowUpPlan.js";
import DepartmentReferral from "../models/DepartmentReferral.js";
import Feedback from "../models/Feedback.js";
import { analyticsPeriod, dateKey, summarizeDoctorAnalytics } from "../services/doctorAnalytics.js";
import { safeDiagnostic } from "../utils/privacySafeLog.js";

const router = asyncRouter();
router.use(protect, requireRole("doctor"));

router.get("/analytics", async (req, res) => {
  try {
    const doctorId = req.user.id;
    const timezone = req.tenant?.timezone || process.env.HOSPITAL_TIMEZONE || "Asia/Kolkata";
    const period = analyticsPeriod(req.query, timezone);
    const dateRange = { $gte: period.utcStart, $lte: period.utcEnd };
    const [tokens, waitingTokens, appointments, consultations, followUps, referrals, feedback] = await Promise.all([
      Token.find({ assignedDoctor: doctorId, createdAt: dateRange })
        .select("patient status queueControl.isOnHold isArchived queueSource urgency arrivalStatus createdAt calledAt completedAt").lean(),
      Token.find({ department: req.user.department, status: "waiting", isArchived: false,
        $or: [{ assignedDoctor: doctorId }, { assignedDoctor: null }], createdAt: dateRange })
        .select("createdAt queueControl.isOnHold").lean(),
      Appointment.find({ doctor: doctorId, appointmentDate: { $gte: period.startDate, $lte: period.endDate } })
        .select("status appointmentDate token").lean(),
      Consultation.find({ doctor: doctorId, createdAt: dateRange })
        .select("diagnosis prescription medicines.name createdAt").lean(),
      FollowUpPlan.find({ doctor: doctorId, $or: [{ createdAt: dateRange }, { completedAt: dateRange }] })
        .select("status createdAt completedAt").lean(),
      DepartmentReferral.find({ $or: [{ fromDoctor: doctorId }, { toDoctor: doctorId }], createdAt: dateRange })
        .select("fromDoctor toDoctor createdAt").lean(),
      Feedback.find({ doctor: doctorId, createdAt: dateRange })
        .select("rating createdAt").lean(),
    ]);
    const patientIds = [...new Set(tokens.map((item) => String(item.patient || "")).filter(Boolean))];
    const olderTokens = patientIds.length ? await Token.find({ assignedDoctor: doctorId, patient: { $in: patientIds }, createdAt: { $lt: period.utcStart } })
      .select("patient").lean() : [];
    const earlierPatientIds = [...olderTokens, ...tokens.filter((item) => dateKey(new Date(item.createdAt), timezone) < period.startDate)]
      .map((item) => String(item.patient || "")).filter(Boolean);
    const scopedReferrals = referrals.map((item) => ({
      ...item, fromDoctor: String(item.fromDoctor || "") === doctorId, toDoctor: String(item.toDoctor || "") === doctorId,
    }));
    return res.json(summarizeDoctorAnalytics(period, { tokens, waitingTokens, appointments, consultations, followUps, referrals: scopedReferrals, feedback, earlierPatientIds }));
  } catch (error) {
    if (!error.status || error.status >= 500) console.error("Doctor analytics request failed:", safeDiagnostic(error));
    return res.status(error.status || 500).json({ message: publicErrorMessage(error, "Unable to load your analytics.") });
  }
});

export default router;
