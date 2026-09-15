import React from 'react';
import { Activity } from 'lucide-react';
import { useLanguage, Trans } from './LanguageContext';
function normalizeToArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.flatMap((item) =>
      typeof item === "string"
        ? item.split(",").map((str) => str.trim()).filter(Boolean)
        : item
    );
  }
  if (typeof data === "string") {
    return data
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function calculatePatientAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let calculatedAge = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    calculatedAge--;
  }
  return Math.max(calculatedAge, 0);
}

export default function ClinicalEhrSummary({activePatient}) {
 const {t}=useLanguage();
 const patientAge=calculatePatientAge(activePatient.dateOfBirth);
 const normalizedAllergies=normalizeToArray(activePatient.allergies);
 const normalizedHistory=normalizeToArray(activePatient.medicalHistory);
 const normalizedMedications=normalizeToArray(activePatient.currentMedications);
 return (<>
      {/* COMPREHENSIVE CLINICAL EHR SUMMARY */}
      <section id="patient-records" className="card patient-ehr-summary-card patient-premium-section">
          <div className="card-title">
            <Activity />
            <h2><Trans text={"Clinical EHR Summary"} /></h2>
          </div>

          <div className="patient-profile-grid" style={{ marginTop: "14px" }}>
            <div className="profile-item">
              <span><Trans text={"Blood Group"} /></span>
              <strong>{activePatient.bloodGroup || t("Not specified")}</strong>
            </div>
            <div className="profile-item">
              <span><Trans text={"Biological Gender"} /></span>
              <strong>{t(activePatient.gender) || t("Not specified")}</strong>
            </div>
            <div className="profile-item">
              <span><Trans text={"Age / DOB"} /></span>
              <strong>
                {activePatient.dateOfBirth
                  ? `${patientAge !== null ? `${patientAge} years` : "Age unavailable"} · ${new Date(activePatient.dateOfBirth).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
                  : "Not recorded"}
              </strong>
            </div>
            <div className="profile-item">
              <span><Trans text={"Emergency Contact"} /></span>
              <strong>
                {activePatient.emergencyContact?.name
                  ? `${activePatient.emergencyContact.name} (${activePatient.emergencyContact.phone || "No phone"})`
                  : "Not provided"}
              </strong>
            </div>
          </div>

          {/* Known Allergies */}
          <div className="medical-section">
            <h3><Trans text={"Known Allergies & Sensitivities"} /></h3>
            {normalizedAllergies.length > 0 ? (
              <div className="medical-tags">
                {normalizedAllergies.map((allergy, index) => (
                  <span key={index} className="medical-tag allergy-tag">
                    {allergy}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted"><Trans text={"No known drug, food, or environmental allergies on file."} /></p>
            )}
          </div>

          {/* Past Medical History & Chronic Conditions */}
          <div className="medical-section">
            <h3><Trans text={"Past Medical History & Chronic Conditions"} /></h3>
            {normalizedHistory.length > 0 ? (
              <ul className="medical-list">
                {normalizedHistory.map((condition, index) => (
                  <li key={index}>{condition}</li>
                ))}
              </ul>
            ) : (
              <p className="muted"><Trans text={"No chronic illnesses or past medical history recorded."} /></p>
            )}
          </div>

          {/* Current Medications & Daily Dosages */}
          <div className="medical-section">
            <h3><Trans text={"Current Medications & Daily Dosages"} /></h3>
            {normalizedMedications.length > 0 ? (
              <ul className="medical-list">
                {normalizedMedications.map((medication, index) => (
                  <li key={index}>{medication}</li>
                ))}
              </ul>
            ) : (
              <p className="muted"><Trans text={"No regular medications or active prescriptions recorded."} /></p>
            )}
          </div>
      </section>

 </>);
}

