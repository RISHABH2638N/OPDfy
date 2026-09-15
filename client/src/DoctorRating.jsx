import { useLanguage, Trans } from "./LanguageContext";
import React from "react";
import { localizeUi } from "./i18n.js";

export function doctorRatingText(doctor) {
  const summary = doctor?.ratingSummary;
  if (!summary) return localizeUi("Rating unavailable");
  if (!summary.reviewCount) return localizeUi("New · No verified rating");
  return localizeUi("★ {rating}/5 · {count} verified {reviews}", {
    rating: Number(summary.averageRating).toFixed(1),
    count: summary.reviewCount,
    reviews: summary.reviewCount === 1 ? "review" : "reviews",
  });
}

export function doctorOptionText(doctor) {
  const profile = doctor.prescriptionProfile || {};
  return [`Dr. ${doctor.name}`, profile.qualification, profile.designation, doctorRatingText(doctor)].filter(Boolean).join(" — ");
}

export default function DoctorRating({ doctor }) {
  const { t } = useLanguage();
  if (!doctor) return null;
  const profile = doctor.prescriptionProfile || {};
  const verification = doctor.professionalVerification || {};
  const verificationText = verification.status === "clinic_reviewed"
    ? "Clinic-reviewed registration"
    : verification.status === "expired"
      ? "Registration review expired"
      : "Registration not clinic-reviewed";
  return <div className="booking-doctor-rating" aria-live="polite">
    <strong><Trans text={"Dr. "} />{doctor.name}</strong>
    {(profile.qualification || profile.designation) && <span>{[profile.qualification, profile.designation].filter(Boolean).join(" · ")}</span>}
    <b>{doctorRatingText(doctor)}</b>
    <span className={`doctor-registration-badge verification-${verification.status || "not_submitted"}`}><Trans text={verificationText} /></span>
    <small><Trans text={"Patient feedback from completed visits at this clinic."} /></small>
    <small><Trans text={"Registration review is recorded by the clinic and is not a government certification."} /></small>
  </div>;
}
