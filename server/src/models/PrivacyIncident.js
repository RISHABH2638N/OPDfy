import mongoose from "mongoose";
const eventSchema = new mongoose.Schema({
 kind: { type: String, enum: ["created", "detected", "alerted", "triage", "containment", "evidence_locked", "notification_review", "notification_recorded", "closure_requested", "closure_approved", "closed", "reopened"], required: true },
 note: { type: String, required: true, maxlength: 2000 },
 evidenceReference: { type: String, default: "", maxlength: 240 },
 actor: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
 actorType: { type: String, enum: ["superadmin", "system"], default: "superadmin" },
 at: { type: Date, default: Date.now },
}, { _id: true, strict: "throw" });
const schema = new mongoose.Schema({
 title: { type: String, required: true, maxlength: 180 },
 description: { type: String, required: true, maxlength: 2000 },
 detectedAt: { type: Date, required: true },
 category: { type: String, enum: ["suspected_data_breach", "confirmed_data_breach", "security_event", "privacy_complaint"], required: true },
 status: { type: String, enum: ["open", "triage", "contained", "notification_review", "closed"], default: "open" },
 severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium", index: true },
 source: { type: String, enum: ["manual", "automatic"], default: "manual" },
 detectionFingerprint: { type: String, default: undefined, maxlength: 64 },
 tenantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tenant" }],
 estimatedAffectedCount: { type: Number, default: null, min: 0 },
 confirmedAffectedCount: { type: Number, default: 0, min: 0 },
 responseDueAt: { type: Date, default: null, index: true },
 evidenceLock: {
  locked: { type: Boolean, default: false }, lockedAt: { type: Date, default: null },
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
  snapshot: { type: mongoose.Schema.Types.ObjectId, ref: "IncidentEvidenceSnapshot", default: null },
  manifestHash: { type: String, default: "", maxlength: 64 }, reason: { type: String, default: "", maxlength: 500 },
 },
 patientNoticeTemplate: {
  subjectEn: { type: String, default: "Important security notice from OPDfy", maxlength: 180 },
  messageEn: { type: String, default: "We identified a security incident that may have involved your information. The affected clinic is investigating and has taken containment steps. Please contact the clinic or platform support for assistance.", maxlength: 4000 },
  subjectHi: { type: String, default: "OPDfy se mahatvapurn suraksha suchna", maxlength: 180 },
  messageHi: { type: String, default: "Hamein ek suraksha ghatna ka pata chala hai jisme aapki jaankari prabhavit ho sakti hai. Sambandhit clinic jaanch aur roktham ki karwai kar raha hai. Sahayata ke liye clinic ya platform support se sampark karein.", maxlength: 4000 },
 },
 securityAlert: {
  status: { type: String, enum: ["pending", "sent", "failed", "not_configured"], default: "pending" },
  sentAt: { type: Date, default: null }, messageId: { type: String, default: "", maxlength: 240 },
  attempts: { type: Number, default: 0, min: 0 }, lastAttemptAt: { type: Date, default: null },
 },
 closure: {
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
  requestedAt: { type: Date, default: null }, requestNote: { type: String, default: "", maxlength: 2000 },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null }, approvedAt: { type: Date, default: null },
  approvalNote: { type: String, default: "", maxlength: 2000 }, evidenceReference: { type: String, default: "", maxlength: 240 },
 },
 notificationDecision: { type: String, enum: ["pending", "required", "not_required", "notified"], default: "pending" },
 notificationReviewedAt: { type: Date, default: null },
 notificationEvidenceReference: { type: String, default: "", maxlength: 240 },
 events: { type: [eventSchema], default: [] },
 createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin", default: null },
}, { timestamps: true, optimisticConcurrency: true, strict: "throw" });
schema.index({ status: 1, createdAt: -1 });
schema.index({ detectionFingerprint: 1 }, { unique: true, sparse: true, name: "privacy_incident_detection_unique" });
export default mongoose.model("PrivacyIncident", schema);
