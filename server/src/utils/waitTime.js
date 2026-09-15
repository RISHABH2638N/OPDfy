import mongoose from "mongoose";
import Token from "../models/Token.js";
import Consultation from "../models/Consultation.js";

const DEFAULT_CONSULTATION_MINUTES = Math.max(
  1,
  Number(process.env.DEFAULT_CONSULTATION_MINUTES || 7)
);

const RECENT_SAMPLE_SIZE = Math.min(
  10,
  Math.max(5, Number.parseInt(process.env.ETA_RECENT_SAMPLE_SIZE || "10", 10) || 10)
);

const MIN_DYNAMIC_SAMPLE_SIZE = 5;
const MIN_VALID_MINUTES = 1;
const MAX_VALID_MINUTES = 120;

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function durationMinutes(token) {
  // Daily queue reset archives yesterday's tokens. Archived consultations
  // must not influence the new day's adaptive ETA; after reset the pace
  // intentionally falls back to DEFAULT_CONSULTATION_MINUTES (7 by default)
  // until enough fresh, unarchived consultations are completed.
  if (!token || token.isArchived === true) {
    return null;
  }

  const start = token?.calledAt ? new Date(token.calledAt).getTime() : NaN;
  const end = token?.completedAt ? new Date(token.completedAt).getTime() : NaN;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  const minutes = (end - start) / 60000;

  if (minutes < MIN_VALID_MINUTES || minutes > MAX_VALID_MINUTES) {
    return null;
  }

  return minutes;
}

async function recentDurations(filter) {
  const consultations =
    await Consultation.find({
      ...filter,
      status: "completed",
    })
      .sort({ createdAt: -1 })
      .limit(RECENT_SAMPLE_SIZE * 3)
      .populate({
        path: "token",
        select: "calledAt completedAt isArchived",
      })
      .select("token")
      .lean();

  return consultations
    .map((item) =>
      durationMinutes(item.token)
    )
    .filter((value) =>
      Number.isFinite(value)
    )
    .slice(0, RECENT_SAMPLE_SIZE);
}

export async function getDoctorConsultationPace({ doctorId, department }) {
  let doctorDurations = [];
  let departmentDurations = [];
  let durations = [];
  let source = "default";

  if (
    doctorId &&
    mongoose.Types.ObjectId.isValid(
      String(doctorId)
    )
  ) {
    doctorDurations =
      await recentDurations({
        doctor: doctorId,
      });
  }

  if (
    doctorDurations.length >=
    MIN_DYNAMIC_SAMPLE_SIZE
  ) {
    durations =
      doctorDurations;
    source =
      "doctor_recent";
  } else if (department) {
    departmentDurations =
      await recentDurations({
        department,
      });

    if (
      departmentDurations.length >=
      MIN_DYNAMIC_SAMPLE_SIZE
    ) {
      durations =
        departmentDurations;
      source =
        "department_recent";
    }
  }

  const averageMinutes =
    durations.length
      ? durations.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / durations.length
      : DEFAULT_CONSULTATION_MINUTES;

  return {
    averageMinutes:
      round1(
        averageMinutes
      ),
    sampleSize:
      durations.length,
    doctorSampleSize:
      doctorDurations.length,
    minimumDynamicSamples:
      MIN_DYNAMIC_SAMPLE_SIZE,
    targetSampleSize:
      RECENT_SAMPLE_SIZE,
    source,
    isDynamic:
      durations.length >=
      MIN_DYNAMIC_SAMPLE_SIZE,
  };
}

export async function getTokenWaitEstimate(tokenOrId) {
  const token =
    typeof tokenOrId === "string" ||
    tokenOrId instanceof mongoose.Types.ObjectId
      ? await Token.findById(tokenOrId).lean()
      : tokenOrId;

  if (!token) {
    const error = new Error("Token not found.");
    error.code = "TOKEN_NOT_FOUND";
    throw error;
  }

  const doctorId =
    token.assignedDoctor?._id ||
    token.assignedDoctor ||
    null;

  const pace = await getDoctorConsultationPace({
    doctorId,
    department: token.department,
  });

  if (token.status === "called") {
    return {
      ...pace,
      tokenId: String(token._id),
      status: token.status,
      patientsAhead: 0,
      currentRemainingMinutes: 0,
      estimatedMinutes: 0,
      lowerMinutes: 0,
      upperMinutes: 0,
      label: "Now serving",
    };
  }

  if (token.queueControl?.isOnHold) {
    return {
      ...pace,
      tokenId: String(token._id),
      status: "held",
      patientsAhead: 0,
      currentRemainingMinutes: 0,
      estimatedMinutes: 0,
      lowerMinutes: 0,
      upperMinutes: 0,
      label: "On hold by reception",
    };
  }

  if (token.status !== "waiting") {
    return {
      ...pace,
      tokenId: String(token._id),
      status: token.status,
      patientsAhead: 0,
      currentRemainingMinutes: 0,
      estimatedMinutes: 0,
      lowerMinutes: 0,
      upperMinutes: 0,
      label: "No active wait",
    };
  }

  const queueFilter = {
    isArchived: { $ne: true },
    department: token.department,
    status: { $in: ["waiting", "called"] },
    "queueControl.isOnHold": { $ne: true },
  };

  if (doctorId) {
    queueFilter.assignedDoctor = doctorId;
  }

  const queue = await Token.find(queueFilter)
    .select("_id tokenNumber status calledAt")
    .sort({ tokenNumber: 1 })
    .lean();

  const patientsAhead = queue.filter(
    (item) =>
      item.status === "waiting" &&
      Number(item.tokenNumber) < Number(token.tokenNumber)
  ).length;

  const current = queue.find(
    (item) =>
      item.status === "called" &&
      String(item._id) !== String(token._id)
  );

  let currentRemainingMinutes = 0;

  if (current?.calledAt) {
    const elapsed = Math.max(
      0,
      (Date.now() - new Date(current.calledAt).getTime()) / 60000
    );

    currentRemainingMinutes = Math.max(
      1,
      pace.averageMinutes - elapsed
    );
  }

  const rawEstimate =
    patientsAhead * pace.averageMinutes +
    currentRemainingMinutes;

  const estimatedMinutes = Math.max(
    0,
    Math.round(rawEstimate)
  );

  const lowerMinutes =
    estimatedMinutes === 0
      ? 0
      : Math.max(1, Math.floor(rawEstimate * 0.85));

  const upperMinutes =
    estimatedMinutes === 0
      ? 0
      : Math.max(
          lowerMinutes + 1,
          Math.ceil(rawEstimate * 1.2)
        );

  return {
    ...pace,
    tokenId: String(token._id),
    status: token.status,
    patientsAhead,
    currentRemainingMinutes: round1(currentRemainingMinutes),
    estimatedMinutes,
    lowerMinutes,
    upperMinutes,
    label:
      estimatedMinutes === 0
        ? "Next patient in line"
        : `Approximately ${lowerMinutes}-${upperMinutes} min`,
  };
}
