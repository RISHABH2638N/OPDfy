import Consultation from "../models/Consultation.js";

const MONEY_MAX = 1000000;

export function cleanMoney(value, fallback = null) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MONEY_MAX) return fallback;
  return Math.round(number * 100) / 100;
}

export function getClinicBilling(tenant = {}) {
  const raw = tenant?.settings?.billing || {};
  const departmentFees = Array.isArray(raw.departmentFees)
    ? raw.departmentFees
        .map((item) => ({ department: String(item?.department || "").trim(), amount: cleanMoney(item?.amount, 0) }))
        .filter((item) => item.department)
    : [];
  return {
    enabled: raw.enabled !== false,
    currency: "INR",
    clinicDefaultFee: cleanMoney(raw.clinicDefaultFee, 0) || 0,
    departmentFees,
    allowReceptionFeeOverride: Boolean(raw.allowReceptionFeeOverride),
    maxDiscountPercent: Math.min(100, Math.max(0, Number(raw.maxDiscountPercent || 0))),
  };
}

export function validateClinicBillingInput(input = {}) {
  const departmentFees = Array.isArray(input.departmentFees)
    ? input.departmentFees.map((item) => ({
        department: String(item?.department || "").trim(),
        amount: cleanMoney(item?.amount, 0) || 0,
      })).filter((item) => item.department)
    : [];
  return {
    enabled: input.enabled !== false,
    currency: "INR",
    clinicDefaultFee: cleanMoney(input.clinicDefaultFee, 0) || 0,
    departmentFees,
    allowReceptionFeeOverride: Boolean(input.allowReceptionFeeOverride),
    maxDiscountPercent: Math.min(100, Math.max(0, Number(input.maxDiscountPercent || 0))),
  };
}

export function cleanDoctorBillingProfile(input = {}) {
  return {
    enabled: input.enabled !== false,
    consultationFee: cleanMoney(input.consultationFee, null),
    followUpFee: cleanMoney(input.followUpFee, null),
    freeFollowUpDays: Math.min(365, Math.max(0, Math.floor(Number(input.freeFollowUpDays || 0)))),
    walkInFee: cleanMoney(input.walkInFee, null),
    reservationFee: cleanMoney(input.reservationFee, null),
    appointmentFee: cleanMoney(input.appointmentFee, null),
    emergencyFee: cleanMoney(input.emergencyFee, null),
  };
}

function fallbackAmount(doctor, tenant, department) {
  const profile = doctor?.billingProfile || {};
  const clinic = getClinicBilling(tenant);
  const departmentFee = clinic.departmentFees.find((item) => item.department === department)?.amount;
  return cleanMoney(profile.consultationFee, null) ?? cleanMoney(departmentFee, null) ?? clinic.clinicDefaultFee;
}

const FOLLOW_UP_WINDOW_DAYS = 5;

function dateOnly(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function followUpQuote({ doctor, tenant, department, patientId, serviceDate = "" }) {
  if (!patientId) {
    const error = new Error("A patient profile is required for a follow-up consultation.");
    error.status = 400;
    throw error;
  }

  const previous = await Consultation.findOne({
    patient: patientId,
    doctor: doctor._id,
    status: "completed",
    followUpDate: { $ne: null },
  })
    .select("createdAt followUpDate")
    .sort({ createdAt: -1 })
    .lean();

  if (!previous?.followUpDate) {
    const error = new Error("No doctor-advised follow-up is available for this doctor. Please choose Normal Consultation.");
    error.status = 409;
    error.code = "FOLLOW_UP_NOT_FOUND";
    throw error;
  }

  const advisedDate = dateOnly(previous.followUpDate);
  const lastConsultationDate = dateOnly(previous.createdAt);
  const windowStart = shiftDate(advisedDate, -FOLLOW_UP_WINDOW_DAYS);
  const windowEnd = shiftDate(advisedDate, FOLLOW_UP_WINDOW_DAYS);
  const targetDate = String(serviceDate || "").trim();
  const profile = doctor?.billingProfile || {};
  const amount = cleanMoney(profile.followUpFee, null) ?? fallbackAmount(doctor, tenant, department) ?? 0;

  const metadata = {
    feeType: "follow_up",
    amount,
    lastConsultationDate,
    advisedFollowUpDate: advisedDate,
    followUpWindowStart: windowStart,
    followUpWindowEnd: windowEnd,
    followUpWindowDays: FOLLOW_UP_WINDOW_DAYS,
  };

  // Appointment fee previews may be requested before the patient chooses a date.
  // Never revive an old recommendation: once the +5 day window has passed it
  // is no longer a valid follow-up, even if it is technically the last visit.
  if (!targetDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (today > windowEnd) {
      const error = new Error(`The doctor-advised follow-up window ended on ${windowEnd}. Please choose Normal Consultation.`);
      error.status = 409;
      error.code = "FOLLOW_UP_OUTSIDE_WINDOW";
      error.followUp = metadata;
      throw error;
    }
    return { ...metadata, requiresServiceDate: true };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < windowStart || targetDate > windowEnd) {
    const error = new Error(`Follow-up is valid only from ${windowStart} to ${windowEnd} for the doctor-advised follow-up on ${advisedDate}. Please choose a date in this window or select Normal Consultation.`);
    error.status = 409;
    error.code = "FOLLOW_UP_OUTSIDE_WINDOW";
    error.followUp = metadata;
    throw error;
  }

  return { ...metadata, serviceDate: targetDate, followUpEligible: true };
}

export async function quoteVisitFee({ doctor, tenant, department, patientId = null, visitType = "consultation", urgency = "normal", consultationKind = "normal", serviceDate = "" }) {
  const clinic = getClinicBilling(tenant);
  const kind = consultationKind === "follow_up" ? "follow_up" : "normal";

  if (!clinic.enabled || doctor?.billingProfile?.enabled === false) {
    return { feeType: kind === "follow_up" ? "follow_up" : visitType, amount: 0, currency: "INR" };
  }

  if (kind === "follow_up") {
    const followUp = await followUpQuote({ doctor, tenant, department, patientId, serviceDate });
    return { ...followUp, currency: "INR" };
  }

  const profile = doctor?.billingProfile || {};
  if (urgency === "emergency") {
    const emergencyFee = cleanMoney(profile.emergencyFee, null);
    if (emergencyFee !== null) return { feeType: "consultation", amount: emergencyFee, currency: "INR", emergencyPricing: true };
  }

  const field = visitType === "walk_in" ? "walkInFee" : visitType === "reservation" ? "reservationFee" : visitType === "appointment" ? "appointmentFee" : "consultationFee";
  const amount = cleanMoney(profile[field], null) ?? fallbackAmount(doctor, tenant, department) ?? 0;
  return { feeType: visitType, amount, currency: "INR" };
}

export function preparePayment({ quotedAmount = 0, payment = {}, tenant, actorId = null }) {
  const clinic = getClinicBilling(tenant);
  const base = cleanMoney(quotedAmount, null);
  if (base === null) throw Object.assign(new Error("Invalid configured consultation fee."), { status: 400 });
  if (base <= 0) {
    return { quotedAmount: base, paidAmount: 0, discountAmount: 0, status: "waived", method: "waived", paidAt: new Date(), collectedBy: actorId };
  }
  // Security boundary: a public/patient QR proves arrival intent, not payment.
  // Any positive-fee visit must be finalized by an authenticated reception/admin actor.
  if (!actorId) {
    const error = new Error(`Consultation fee ₹${base} must be confirmed by reception before check-in.`);
    error.status = 403;
    error.code = "STAFF_PAYMENT_CONFIRMATION_REQUIRED";
    error.paymentRequired = true;
    error.amountDue = base;
    throw error;
  }
  const method = String(payment.method || "").toLowerCase();
  if (!["cash", "upi", "card", "other"].includes(method)) {
    const error = new Error(`Consultation fee ₹${base} is pending. Reception must confirm Cash, UPI, Card or Other payment before check-in.`);
    error.status = 402;
    error.paymentRequired = true;
    error.amountDue = base;
    throw error;
  }
  const paidAmount = cleanMoney(payment.paidAmount, null);
  if (paidAmount === null || typeof payment.paidAmount === "boolean" || typeof payment.paidAmount === "object") {
    throw Object.assign(new Error("Enter a valid paid amount."), { status: 400 });
  }
  const discountAmount = Math.max(0, Math.round((base - paidAmount) * 100) / 100);
  const discountPercent = base ? (discountAmount / base) * 100 : 0;
  if (paidAmount > base) {
    const error = new Error("Paid amount cannot exceed the configured consultation fee."); error.status = 400; throw error;
  }
  if (discountAmount > 0) {
    if (!clinic.allowReceptionFeeOverride) {
      const error = new Error("Reception fee override/discount is disabled by clinic admin."); error.status = 403; throw error;
    }
    if (discountPercent > clinic.maxDiscountPercent + 0.0001) {
      const error = new Error(`Maximum allowed reception discount is ${clinic.maxDiscountPercent}%.`); error.status = 400; throw error;
    }
    if (!String(payment.overrideReason || "").trim()) {
      const error = new Error("Enter a reason for the fee discount/override."); error.status = 400; throw error;
    }
  }
  return {
    quotedAmount: base,
    paidAmount,
    discountAmount,
    status: paidAmount === 0 ? "waived" : "paid",
    method: paidAmount === 0 ? "waived" : method,
    transactionReference: String(payment.transactionReference || "").trim().slice(0, 120),
    overrideReason: String(payment.overrideReason || "").trim().slice(0, 240),
    paidAt: new Date(),
    collectedBy: actorId,
  };
}

export function receiptNumberForToken(token) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `OPD-${stamp}-${String(token?._id || "").slice(-8).toUpperCase()}`;
}

export async function attachPaymentToToken(token, paymentData = {}, feeType = "consultation") {
  token.billing = {
    feeType,
    ...paymentData,
    receiptNumber: paymentData.status === "pending" ? "" : receiptNumberForToken(token),
  };
  await token.save();
  return token.billing;
}
