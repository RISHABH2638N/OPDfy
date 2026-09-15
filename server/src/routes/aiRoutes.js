import { hasExternalAiConsent } from "../services/privacyConsentService.js";
import { asyncRouter, publicErrorMessage } from "../utils/httpSafety.js";
import express from "express";
import rateLimit from "express-rate-limit";
import Token from "../models/Token.js";
import User from "../models/User.js";
import { protectPatient } from "../middleware/patientAuth.js";
import { DEPARTMENTS } from "../utils/departments.js";
import { getDoctorAvailability } from "../utils/doctorAvailability.js";
import { getTokenWaitEstimate } from "../utils/waitTime.js";
import { processQueueNotifications } from "../services/notificationService.js";
import { createOnlineQueueReservation } from "../services/queueReservationService.js";
import { emitOperationalUpdate, emitQueueUpdate } from "../services/realtimeService.js";
import { createRateLimitStore } from "../utils/rateLimitStore.js";

function aiReply(res, payload) {
  return res.json({ source: "built-in", externalAIUsed: false,
    externalAIContacted: Boolean(res.locals?.externalAIContacted), ...payload });
}

const router = asyncRouter();
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AI_RATE_MAX_PER_MINUTE || 12),
  store: createRateLimitStore("ai-patient"),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.patient?._id || "patient"),
  message: { message: "AI request limit reached. Please try again shortly." },
});


const TRIAGE_DEPARTMENTS = [
  ...DEPARTMENTS,
];

const EMERGENCY_PATTERNS = [
  /chest\s*pain/i,
  /pressure\s*in\s*(the\s*)?chest/i,
  /difficulty\s*breath/i,
  /shortness\s*of\s*breath/i,
  /cannot\s*breath/i,
  /severe\s*bleed/i,
  /uncontrolled\s*bleed/i,
  /unconscious/i,
  /not\s*conscious/i,
  /fainted|fainting/i,
  /seizure|convulsion/i,
  /stroke/i,
  /face\s*droop/i,
  /slurred\s*speech/i,
  /sudden\s*weakness/i,
  /suicid/i,
];

function detectEmergency(text) {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

function detectBookingIntent(message) {
  return /\b(book|booking|reserve|reservation|get|generate|issue|take)\b.*\b(token|appointment|opd)\b|\b(token|appointment|opd)\b.*\b(book|booking|reserve|reservation|get|generate|issue|take)\b/i.test(message);
}

function detectDepartmentFromMessage(message) {
  const text = String(message || "").toLowerCase();

  if (/\b(dermatolog(y|ist)|skin|skin doctor|skin specialist)\b/i.test(text)) return "Dermatology";
  if (/\b(orthopedic|orthopaedic|orthopedics|orthopaedics|bone|bone doctor)\b/i.test(text)) return "Orthopedics";
  if (/\b(cardiolog(y|ist)|heart|heart doctor)\b/i.test(text)) return "Cardiology";
  if (/\b(ent|ear nose throat|ear|throat|nose)\b/i.test(text)) return "ENT";
  if (/\b(pediatric(s|ian)?|paediatric(s|ian)?|child doctor|children)\b/i.test(text)) return "Pediatrics";
  if (/\b(general opd|general medicine|general doctor|physician)\b/i.test(text)) return "General OPD";

  return null;
}

function fallbackTriage(symptoms) {
  const text = symptoms.toLowerCase();

  if (detectEmergency(symptoms)) {
    return {
      department: "General OPD",
      urgency: "emergency",
      confidence: 0.98,
      reason: "The symptoms contain a potential emergency warning sign.",
      redFlags: ["Potential emergency symptoms reported."],
      nextStep: "Do not wait in the routine OPD queue. Seek emergency medical care immediately.",
      disclaimer: "This is a preliminary routing aid, not a medical diagnosis.",
    };
  }

  let department = "General OPD";
  let reason = "The symptoms are not specific enough for a specialty recommendation, so General OPD is the safest starting point.";
  let confidence = 0.55;

  if (/(rash|itch|itching|acne|pimple|eczema|psoriasis|skin|hair|dandruff|fungal|allergy|hives)/i.test(text)) {
    department = "Dermatology";
    reason = "The symptoms appear primarily related to skin, hair, or allergic skin concerns.";
    confidence = 0.88;
  } else if (/(bone|joint|knee|back|neck|shoulder|fracture|sprain|muscle|ligament|arthritis|ankle|wrist|elbow|hip)/i.test(text)) {
    department = "Orthopedics";
    reason = "The symptoms appear related to bones, joints, muscles, or movement.";
    confidence = 0.87;
  } else if (/(ear|hearing|throat|tonsil|sinus|nose|nasal|voice|vertigo)/i.test(text)) {
    department = "ENT";
    reason = "The symptoms involve the ear, nose, throat, hearing, or related balance symptoms.";
    confidence = 0.86;
  } else if (/(heart|chest discomfort|palpitation|palpitations|heartbeat|blood pressure|bp)/i.test(text)) {
    department = "Cardiology";
    reason = "The symptoms may involve the cardiovascular system and should be assessed by a clinician.";
    confidence = 0.78;
  } else if (/(child|baby|infant|toddler|kid|son|daughter|pediatric)/i.test(text)) {
    department = "Pediatrics";
    reason = "The request appears to concern a child.";
    confidence = 0.82;
  }

  return {
    department,
    urgency: "normal",
    confidence,
    reason,
    redFlags: [],
    nextStep: `You can start with ${department}. A qualified clinician will make the final assessment.`,
    disclaimer: "This is a preliminary routing aid, not a medical diagnosis.",
  };
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeTriage(result, symptoms) {
  const emergency = detectEmergency(symptoms);
  const department = TRIAGE_DEPARTMENTS.includes(result?.department)
    ? result.department
    : "General OPD";

  const allowedUrgency = ["normal", "priority", "emergency"];
  const urgency = emergency
    ? "emergency"
    : allowedUrgency.includes(result?.urgency)
      ? result.urgency
      : "normal";

  const confidence = Math.max(
    0,
    Math.min(1, Number(result?.confidence) || 0.5),
  );

  return {
    department: emergency ? "General OPD" : department,
    urgency,
    confidence: Number(confidence.toFixed(2)),
    reason:
      String(result?.reason || "A clinician should review these symptoms.").trim(),
    redFlags: Array.isArray(result?.redFlags)
      ? result.redFlags.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
    nextStep:
      emergency
        ? "Do not wait in the routine OPD queue. Seek emergency medical care immediately."
        : String(
            result?.nextStep ||
              `You can start with ${department}. A qualified clinician will make the final assessment.`,
          ).trim(),
    disclaimer:
      "This is a preliminary routing aid, not a medical diagnosis.",
  };
}

/* =========================================================
   UNIFIED PATIENT AI GUIDE

   The same assistant handles:
   - patient-specific queue questions
   - department-aware "next token" / ETA questions
   - direct token booking
   - department selection from symptoms
   - normal/emergency token intent
========================================================= */
function isHindiLike(text) {
  return /[\u0900-\u097F]/.test(text) || /\b(mera|meri|mujhe|kab|kitna|kitne|agla|next|token|dikhana|doctor|queue|number|aayega|aaega|hai|hain|karo|karna)\b/i.test(text);
}

function wantsQueueInfo(message) {
  return /\b(next|upcoming|current|running|serving|wait|waiting|queue|number|turn|kab|kitna|kitne|agla|aage|baari)\b/i.test(message);
}

function wantsEta(message) {
  return /\b(when|how long|eta|time|turn|wait|kab|kitni der|kitna time|number kab|baari kab)\b/i.test(message);
}

function wantsBooking(message) {
  const department = detectDepartmentFromMessage(message);
  const bookingVerb = /\b(book|booking|reserve|reservation|generate|issue|take|create|token book|token generate|token bana|dikhana hai|doctor ko dikh|appointment|karo|karwa)\b/i.test(message);
  const tokenContext = /\b(token|appointment|opd|queue|doctor|dikh|book)\b/i.test(message);
  return Boolean(department) && bookingVerb && tokenContext;
}

function requestedUrgency(message) {
  return /\b(emergency|urgent|critical|आपात|इमरजेंसी|emergency case)\b/i.test(message)
    ? "emergency"
    : "normal";
}


function wantsDoctorAvailability(message) {
  return /\b(available|availability|availabe|working|duty|shift|timing|time|kab tak|kitne baje|aaj|today|off|leave|break|doctor hai|doctor available)\b/i.test(message);
}

function doctorNameMatches(message, doctorName) {
  const haystack = String(message || "").toLowerCase();
  const fullName = String(doctorName || "").toLowerCase().replace(/^dr\.?\s*/, "").trim();
  if (!fullName) return false;
  const parts = fullName.split(/\s+/).filter((part) => part.length >= 3);
  return haystack.includes(fullName) || parts.some((part) => haystack.includes(part));
}

function doctorAvailabilityReply(doctor, availability, message) {
  const hindi = isHindiLike(message);
  const room = availability.roomNumber ? (hindi ? ` Room ${availability.roomNumber}.` : ` Room ${availability.roomNumber}.`) : "";
  if (availability.isAvailable) {
    return hindi
      ? `Haan, Dr. ${doctor.name} aaj available hain aur ${availability.endTime} baje tak duty par hain.${room}`
      : `Yes, Dr. ${doctor.name} is available today until ${availability.endTime}.${room}`;
  }
  if (availability.status === "before_shift") {
    return hindi
      ? `Dr. ${doctor.name} aaj duty par hain, lekin unki shift ${availability.startTime} baje start hogi aur ${availability.endTime} baje tak rahegi.${room}`
      : `Dr. ${doctor.name} is scheduled today, but the shift starts at ${availability.startTime} and ends at ${availability.endTime}.${room}`;
  }
  if (availability.status === "weekly_off") {
    return hindi
      ? `Nahi, Dr. ${doctor.name} aaj (${availability.weekday}) off hain.`
      : `No, Dr. ${doctor.name} is off today (${availability.weekday}).`;
  }
  if (availability.status === "leave") {
    return hindi
      ? `Nahi, Dr. ${doctor.name} aaj unavailable/leave par hain.`
      : `No, Dr. ${doctor.name} is unavailable/on leave today.`;
  }
  if (availability.status === "on_break") {
    return hindi
      ? `Dr. ${doctor.name} ki shift aaj ${availability.endTime} baje tak hai, lekin abhi woh break par hain.`
      : `Dr. ${doctor.name}'s shift runs until ${availability.endTime} today, but the doctor is currently on break.`;
  }
  return hindi
    ? `Nahi, Dr. ${doctor.name} ki aaj ki shift ${availability.endTime} baje khatam ho chuki hai.`
    : `No, Dr. ${doctor.name}'s shift ended at ${availability.endTime} today.`;
}

async function buildPatientQueueAnswer({ message, activeToken, tokens }) {
  const hindi = isHindiLike(message);

  if (!activeToken) {
    return hindi
      ? "Aapka abhi koi active token nahi hai. Aap mujhe symptoms aur department bata kar token book karwa sakte hain."
      : "You do not have an active token right now. Tell me your symptoms and department, and I can book the token for you.";
  }

  const department = activeToken.department;

  const assignedDoctorId = activeToken.assignedDoctor
    ? String(
        activeToken.assignedDoctor?._id ||
        activeToken.assignedDoctor
      )
    : null;

  const departmentTokens = tokens.filter(
    (token) => {
      if (
        token.department !==
        department
      ) {
        return false;
      }

      if (!assignedDoctorId) {
        return true;
      }

      return (
        String(
          token.assignedDoctor?._id ||
          token.assignedDoctor ||
          ""
        ) === assignedDoctorId
      );
    }
  );

  const current =
    departmentTokens.find(
      (token) =>
        token.status === "called"
    );

  const nextWaiting =
    departmentTokens
      .filter(
        (token) =>
          token.status === "waiting"
      )
      .sort(
        (a, b) =>
          Number(a.tokenNumber) -
          Number(b.tokenNumber)
      )[0];

  const eta =
    await getTokenWaitEstimate(
      activeToken
    );

  const paceText =
    eta.isDynamic
      ? hindi
        ? `Ye estimate doctor ki recent ${eta.sampleSize} completed consultation ke actual average (${eta.averageMinutes} min/patient) par based hai.`
        : `This estimate uses the doctor's recent ${eta.sampleSize} completed consultations, averaging ${eta.averageMinutes} minutes per patient.`
      : hindi
        ? `Doctor ka dynamic pace abhi learn ho raha hai (${eta.doctorSampleSize}/${eta.minimumDynamicSamples} completed consultations). Tab tak ${eta.averageMinutes} minute ka temporary baseline use ho raha hai.`
        : `The doctor's dynamic pace is still learning (${eta.doctorSampleSize}/${eta.minimumDynamicSamples} completed consultations). Until then, a temporary ${eta.averageMinutes}-minute baseline is being used.`;

  if (wantsEta(message)) {
    if (
      activeToken.status ===
      "called"
    ) {
      return hindi
        ? `Aapka ${department} token #${activeToken.tokenNumber} abhi call ho raha hai — aapki baari ab hai.`
        : `Your ${department} token #${activeToken.tokenNumber} is being served now — it is your turn.`;
    }

    const waitText =
      eta.estimatedMinutes <= 0
        ? hindi
          ? "Aap next patient hain."
          : "You are next in line."
        : hindi
          ? `Estimated wait lagbhag ${eta.lowerMinutes}-${eta.upperMinutes} minute hai.`
          : `Estimated wait is approximately ${eta.lowerMinutes}-${eta.upperMinutes} minutes.`;

    return hindi
      ? `Aapka ${department} token #${activeToken.tokenNumber} hai. Aapse pehle ${eta.patientsAhead} patient hain. ${waitText} ${paceText}`
      : `Your ${department} token is #${activeToken.tokenNumber}. There are ${eta.patientsAhead} patients ahead of you. ${waitText} ${paceText}`;
  }

  if (
    /\b(next|agla|upcoming)\b/i.test(
      message
    )
  ) {
    const nextNumber =
      nextWaiting?.tokenNumber ??
      (current
        ? Number(
            current.tokenNumber
          ) + 1
        : null);

    return nextNumber
      ? hindi
        ? `${department} queue mein next waiting token #${nextNumber} hai. Aapka token #${activeToken.tokenNumber} hai.`
        : `The next waiting token in ${department} is #${nextNumber}. Your token is #${activeToken.tokenNumber}.`
      : hindi
        ? `${department} mein abhi koi next waiting token nahi hai.`
        : `There is no next waiting token in ${department} right now.`;
  }

  return hindi
    ? `Aapka active token ${department} ka #${activeToken.tokenNumber} hai. Abhi ${current ? `#${current.tokenNumber}` : "koi token call nahi hua"} serve ho raha hai. Aapse pehle ${eta.patientsAhead} patient hain.`
    : `Your active token is ${department} #${activeToken.tokenNumber}. ${current ? `Token #${current.tokenNumber} is currently being served` : "No token is currently being served"}. There are ${eta.patientsAhead} patients ahead of you.`;
}

async function createPatientReservation(patient, doctor, department, tenantId, urgency = "normal") {
  return createOnlineQueueReservation({
    tenantId,
    patient,
    doctor,
    department,
    urgency,
  });
}

router.post("/chat", protectPatient, aiLimiter, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    if (!message) return res.status(400).json({ message: "Message is required." });
    if (Buffer.byteLength(message, "utf8") > 4096) return res.status(413).json({ message: "Please keep AI messages under 4 KB." });
    const allowExternalAI = req.body.allowExternalAI === true && await hasExternalAiConsent(req.globalPatient._id);

    const Patient = (await import("../models/Patient.js")).default;
    const patient = await Patient.findById(req.patient._id);
    if (!patient) return res.status(404).json({ message: "Patient profile not found." });

    if (wantsDoctorAvailability(message)) {
      const doctors = await User.find({ role: "doctor" })
        .select("_id name department doctorSchedule")
        .sort({ name: 1 })
        .lean();
      const matchedDoctors = doctors.filter((doctor) => doctorNameMatches(message, doctor.name));
      if (matchedDoctors.length === 1) {
        const doctor = matchedDoctors[0];
        const availability = getDoctorAvailability(doctor);
        return aiReply(res,{
          reply: doctorAvailabilityReply(doctor, availability, message),
          action: "doctor_availability",
          doctor: { _id: doctor._id, name: doctor.name, department: doctor.department },
          availability,
        });
      }
      if (matchedDoctors.length > 1) {
        return aiReply(res,{
          reply: isHindiLike(message)
            ? "Is naam se ek se zyada doctors mile. Kripya doctor ka poora naam batayein."
            : "I found more than one doctor matching that name. Please provide the doctor's full name.",
          action: "doctor_name_ambiguous",
          doctors: matchedDoctors.map(({ _id, name, department }) => ({ _id, name, department })),
        });
      }
    }

    const tokens = await Token.find({ isArchived: { $ne: true } }).sort({ department: 1, tokenNumber: 1 }).lean();
    const activeToken = tokens.find(
      (token) =>
        String(token.patient) === String(patient._id) &&
        ["waiting", "called"].includes(token.status),
    );

    /* DIRECT TOKEN BOOKING FROM THE SAME AI */
    if (wantsBooking(message)) {
      let department = detectDepartmentFromMessage(message);
      let triage = null;

      // If the patient gives symptoms but not a specialty, use the same
      // triage rules as the Smart Triage endpoint to choose the department.
      if (!department) {
        triage = fallbackTriage(message);
        if (triage.urgency === "emergency") {
          return aiReply(res,{
            reply: isHindiLike(message)
              ? "Aapke symptoms mein possible emergency warning signs hain. Routine OPD token book karne ke bajay turant emergency medical care lein."
              : "Your symptoms may contain emergency warning signs. Please seek immediate emergency medical care instead of waiting in the routine OPD queue.",
            action: "emergency_guidance",
            triage,
          });
        }
        department = triage.department;
      }

      if (!DEPARTMENTS.includes(department)) {
        return aiReply(res,{
          reply: "Please tell me which department you want: Dermatology, Orthopedics, ENT, Cardiology, Pediatrics, or General OPD.",
          action: "booking_department_required",
        });
      }

      if (!patient.profileCompleted) {
        return res.status(400).json({
          message: "Please complete your patient profile before booking a token.",
        });
      }

      const availableDoctors = await User.find({
        role: "doctor",
        department,
      })
        .select("_id name department doctorSchedule")
        .sort({ name: 1 })
        .lean();

      const bookableDoctors = availableDoctors.filter(
        (doctor) => getDoctorAvailability(doctor).isAvailable
      );

      if (!bookableDoctors.length) {
        return res.status(409).json({
          message: `No ${department} doctor is available right now. Please try during a doctor's working hours or choose another available specialist.`,
        });
      }

      const normalizedMessage = message.toLowerCase();
      let selectedDoctor = bookableDoctors.find((doctor) => {
        const fullName = String(doctor.name || "").toLowerCase().replace(/^dr\.?\s*/, "").trim();
        if (!fullName) return false;
        const lastName = fullName.split(/\s+/).pop();
        return normalizedMessage.includes(fullName) ||
          (lastName && lastName.length >= 3 && normalizedMessage.includes(lastName));
      });

      if (!selectedDoctor && bookableDoctors.length === 1) {
        selectedDoctor = bookableDoctors[0];
      }

      if (!selectedDoctor) {
        const hindi = isHindiLike(message);
        return aiReply(res,{
          reply: hindi
            ? `${department} mein ${bookableDoctors.length} doctors available hain. Kripya jis doctor ko dikhana hai use select karein.`
            : `${bookableDoctors.length} ${department} doctors are available. Please choose the specialist you want for this token.`,
          action: "doctor_selection_required",
          department,
          doctors: bookableDoctors.map((doctor) => ({
            _id: doctor._id,
            name: doctor.name,
            department: doctor.department,
          })),
        });
      }

      const selectedAvailability = getDoctorAvailability(selectedDoctor);
      if (!selectedAvailability.isAvailable) {
        return res.status(409).json({
          message: selectedAvailability.reason,
          reply: doctorAvailabilityReply(selectedDoctor, selectedAvailability, message),
          action: "doctor_unavailable",
          availability: selectedAvailability,
        });
      }

      const requestedPatientUrgency = requestedUrgency(message);
      const urgency = "normal"; // authoritative emergency priority requires staff/clinical validation
      try {
        const reservation = await createPatientReservation(
          patient,
          selectedDoctor,
          department,
          req.tenantId,
          urgency
        );
        const hindi = isHindiLike(message);
        return aiReply(res,{
          reply: hindi
            ? `Aapki ${department} online reservation Dr. ${selectedDoctor.name} ke saath confirm hai${requestedPatientUrgency === "emergency" ? "; emergency concern reception ko batayein" : ""}. Final FCFS token hospital pahunchkar reception/QR check-in ke baad milega.`
            : `Your ${department} online reservation with Dr. ${selectedDoctor.name} is confirmed${requestedPatientUrgency === "emergency" ? "; please tell reception about your emergency concern" : ""}. Your final FCFS token will be issued only after hospital arrival and reception/QR check-in.`,
          action: "reservation_created",
          doctor: {
            _id: selectedDoctor._id,
            name: selectedDoctor.name,
            department: selectedDoctor.department,
          },
          reservation: {
            _id: reservation._id,
            department: reservation.department,
            doctor: reservation.doctor,
            doctorName: reservation.doctorName,
            urgency: reservation.urgency,
            status: reservation.status,
            reservationDate: reservation.reservationDate,
          },
        });
      } catch (error) {
        if (error.code === "ACTIVE_TOKEN") {
          return res.status(409).json({
            message: error.message,
            reply: isHindiLike(message)
              ? `Aapka pehle se active token #${error.token.tokenNumber} hai (${error.token.department}). Pehle us consultation ko complete karein.`
              : `You already have active token #${error.token.tokenNumber} for ${error.token.department}. Please complete that consultation before booking another token.`,
            action: "active_token_exists",
            token: error.token,
          });
        }
        throw error;
      }
    }

    /* PATIENT-SPECIFIC QUEUE QUESTIONS NEVER GO THROUGH A GENERIC SNAPSHOT */
    if (activeToken && wantsQueueInfo(message)) {
      return aiReply(res,{
        reply: await buildPatientQueueAnswer({ message, activeToken, tokens }),
        action: "patient_queue_status",
        token: {
          tokenNumber: activeToken.tokenNumber,
          department: activeToken.department,
          status: activeToken.status,
          urgency: activeToken.urgency || "normal",
        },
      });
    }

    const requestedDepartment = detectDepartmentFromMessage(message);
    const scopeDepartment = requestedDepartment || activeToken?.department || null;
    const scopedTokens = scopeDepartment
      ? tokens.filter((token) => token.department === scopeDepartment)
      : tokens;
    const current = scopedTokens.find((token) => token.status === "called");
    const waiting = scopedTokens.filter((token) => token.status === "waiting");
    const activeEta =
      activeToken
        ? await getTokenWaitEstimate(
            activeToken
          )
        : null;

    const snapshot = {
      patient: {
        activeToken: activeToken
          ? {
              tokenNumber: activeToken.tokenNumber,
              department: activeToken.department,
              status: activeToken.status,
            }
          : null,
        liveEta: activeEta,
      },
      queueScope: scopeDepartment || "all departments",
      currentToken: current?.tokenNumber ?? null,
      waitingCount: waiting.length,
      nextWaitingToken: waiting.sort((a, b) => Number(a.tokenNumber) - Number(b.tokenNumber))[0]?.tokenNumber ?? null,
      departments: [...new Set(tokens.map((t) => t.department))],
    };

    if (!process.env.GEMINI_API_KEY || !allowExternalAI) {
      if (wantsQueueInfo(message)) {
        return aiReply(res,{
          reply: await buildPatientQueueAnswer({ message, activeToken, tokens }),
          action: "patient_queue_status",
        });
      }
      return aiReply(res,{
        reply: "I can help with your department queue, token status, waiting time, and direct token booking. You can also ask me in Hindi or English.",
      });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const prompt = `You are the patient's unified OPDfy assistant. Answer using the live patient-specific queue snapshot below. Never mix departments. If the patient has an active token, treat that department as their personal queue unless they explicitly ask about another department. Be concise and support English/Hindi/Hinglish. Never invent token numbers or wait times. For medical advice, recommend a qualified clinician.\nLIVE PATIENT QUEUE: ${JSON.stringify(snapshot)}\nUSER: ${message}`;
    if (!await hasExternalAiConsent(req.globalPatient._id)) {
      return aiReply(res,{ reply: "External AI consent is not active. Built-in queue help remains available.",
        action: "consent_required", externalAIUsed: false });
    }
    res.locals.externalAIContacted = true;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024 } }),
      },
    );
    const data = await response.json();
    if (!response.ok) return aiReply(res.status(502), { message: "AI assistant temporarily unavailable." });
    return aiReply(res,{
      reply: data?.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.",
      action: "chat_answer", source: "gemini", externalAIUsed: true,
    });
  } catch (e) {
    console.error("AI assistant unavailable:", e?.code || e?.name || "ERROR");
    aiReply(res.status(e.status || 500), { message: e.status ? e.message : "AI assistant unavailable." });
  }
});

/* =========================================================
   AI SMART TRIAGE

   POST /api/ai/triage
   Patient-authenticated endpoint.

   This endpoint recommends a queue department. It does not
   diagnose or prescribe treatment.
========================================================= */
router.post("/triage", protectPatient, aiLimiter, async (req, res) => {
  try {
    const symptoms = String(req.body.symptoms || "").trim();
    const allowExternalAI = req.body.allowExternalAI === true && await hasExternalAiConsent(req.globalPatient._id);

    if (symptoms.length < 8) {
      return res.status(400).json({
        message: "Please describe your symptoms in a little more detail.",
      });
    }

    if (symptoms.length > 1500) {
      return res.status(400).json({
        message: "Please keep the symptom description below 1500 characters.",
      });
    }

    const fallback = fallbackTriage(symptoms);

    if (!process.env.GEMINI_API_KEY || !allowExternalAI) {
      return aiReply(res,{
        triage: fallback,
        source: "rule-based-fallback",
        externalAIUsed: false,
      });
    }

    const patient = req.patient;
    // Data minimization: external AI receives no name, email, phone, medication list,
    // conditions, allergies, or clinic identifiers. Only coarse demographic context is sent.
    const patientContext = {
      ageBand: patient?.dateOfBirth ? `${Math.floor(Math.max(0, new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear()) / 10) * 10}s` : null,
      gender: patient?.gender || null,
    };

    const model = process.env.GEMINI_TRIAGE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const prompt = `You are the preliminary OPD routing assistant for a hospital queue system. Your job is ONLY to recommend the most appropriate OPD department for routing. You are NOT a doctor. Do not diagnose diseases, prescribe medicines, or provide treatment plans.

Allowed departments ONLY:
${JSON.stringify(TRIAGE_DEPARTMENTS)}

Urgency values ONLY:
- normal: routine OPD evaluation
- priority: symptoms appear to need faster clinical review, but are not clearly an emergency
- emergency: potential emergency warning signs; patient should not wait in a routine OPD queue

Rules:
1. Prefer General OPD when the symptoms are vague or do not clearly map to one specialty.
2. Dermatology: skin, rash, itching, acne, eczema, psoriasis, hair/scalp concerns.
3. Orthopedics: bones, joints, muscles, back/neck pain, fractures, sprains, movement-related problems.
4. ENT: ear, nose, throat, hearing, sinus, voice and related balance complaints.
5. Cardiology: cardiovascular symptoms such as palpitations or suspected heart-related complaints.
6. Pediatrics: when the patient is a child and the complaint should be assessed in pediatrics.
7. Emergency warning signs such as severe chest pain, severe breathing difficulty, uncontrolled bleeding, loss of consciousness, seizure, stroke-like symptoms, or immediate self-harm risk must be marked emergency.
8. Do not claim certainty. Give a short routing reason.
9. Never tell the patient to take a specific medicine.

Patient context:
${JSON.stringify(patientContext)}

Patient's symptom description:
${JSON.stringify(symptoms)}

Return ONLY valid JSON with this exact shape:
{
  "department": "one allowed department",
  "urgency": "normal|priority|emergency",
  "confidence": 0.0,
  "reason": "short routing explanation",
  "redFlags": ["possible warning sign"],
  "nextStep": "short safe next step"
}`;

    if (!await hasExternalAiConsent(req.globalPatient._id)) {
      return aiReply(res,{ triage: fallback, source: "rule-based-fallback", externalAIUsed: false });
    }
    res.locals.externalAIContacted = true;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini triage provider error:", response.status);
      return aiReply(res,{
        triage: fallback,
        source: "rule-based-fallback",
        warning: "AI service was unavailable, so safe rule-based routing was used.",
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJson(text);

    if (!parsed) {
      return aiReply(res,{
        triage: fallback,
        source: "rule-based-fallback",
        warning: "AI returned an unreadable result, so safe rule-based routing was used.",
      });
    }

    return aiReply(res,{
      triage: sanitizeTriage(parsed, symptoms),
      source: "gemini", externalAIUsed: true,
    });
  } catch (error) {
    console.error("AI triage unavailable:", error?.code || error?.name || "ERROR");

    return aiReply(res,{
      triage: fallbackTriage(String(req.body.symptoms || "")),
      source: "rule-based-fallback",
      warning: "AI service was unavailable, so safe rule-based routing was used.",
    });
  }
});

export default router;
