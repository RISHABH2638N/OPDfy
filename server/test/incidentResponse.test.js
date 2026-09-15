import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import PrivacyIncident from "../src/models/PrivacyIncident.js";
import IncidentNotificationDelivery from "../src/models/IncidentNotificationDelivery.js";

const objectId = "aaaaaaaaaaaaaaaaaaaaaaaa";

test("automatic incident supports system events, severity, countdown and evidence state", async () => {
  const incident = new PrivacyIncident({ title: "Repeated suspicious login attempts", description: "Five failed staff logins were detected within fifteen minutes.", detectedAt: new Date(), responseDueAt: new Date(Date.now()+3600000), category: "security_event", severity: "high", source: "automatic", detectionFingerprint: "a".repeat(64), events: [{ kind: "detected", note: "Automatic detection rule triggered from a security event.", actorType: "system" }] });
  await incident.validate();
  assert.equal(incident.severity, "high"); assert.equal(incident.events[0].actor, null); assert.equal(incident.evidenceLock.locked, false);
});

test("patient notification delivery exposes separate in-app and email states", async () => {
  const delivery = new IncidentNotificationDelivery({ incident: objectId, affectedPatient: objectId, tenantId: objectId, patientId: objectId, inApp: { status: "delivered", deliveredAt: new Date() }, email: { status: "failed", failureCode: "ETIMEDOUT" } });
  await delivery.validate(); assert.equal(delivery.inApp.status, "delivered"); assert.equal(delivery.email.status, "failed");
});

test("incident endpoints remain owner-only and require step-up for destructive or sending actions", () => {
  const routes = fs.readFileSync(new URL("../src/routes/privacyPhase4Routes.js", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../src/services/incidentResponseService.js", import.meta.url), "utf8");
  assert.match(routes, /router\.use\(protectSuperAdmin\)/);
  assert.match(service, /verifyPlatformPassword\(ownerId/);
  assert.match(service, /A different active platform administrator must approve closure/);
  assert.match(service, /affected-individual legal assessment before sending/);
  assert.match(service, /DRAFT_REQUIRES_AUTHORISED_REVIEW/);
  assert.doesNotMatch(service, /dropDatabase\(|deleteMany\(/);
});
