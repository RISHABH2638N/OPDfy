import test from "node:test";
import assert from "node:assert/strict";
import { socketClientKey, createSocketAdmission } from "../src/utils/socketAdmission.js";

const request = (ip, forwarded = "") => ({ socket: { remoteAddress: ip }, headers: { "x-forwarded-for": forwarded } });

test("socket quotas normalize addresses and trust only configured proxy hops", () => {
  assert.equal(socketClientKey(request("::ffff:192.0.2.1"), 0), "192.0.2.1");
  assert.equal(socketClientKey(request("192.0.2.1", "203.0.113.1"), 0), "192.0.2.1");
  assert.equal(socketClientKey(request("192.0.2.1", "198.51.100.1, 203.0.113.1"), 1), "203.0.113.1");
  assert.equal(socketClientKey(request("192.0.2.1", "198.51.100.1, 203.0.113.1"), 2), "198.51.100.1");
  assert.equal(socketClientKey(request("192.0.2.1", "invalid"), 1), "192.0.2.1");
  assert.equal(socketClientKey(request("2001:db8:0:1::10"), 0), socketClientKey(request("2001:0db8:0000:0001:abcd::20"), 0));
  assert.notEqual(socketClientKey(request("2001:db8:0:1::10"), 0), socketClientKey(request("2001:db8:0:2::10"), 0));
  assert.equal(socketClientKey(request("::"), 0), "0:0:0:0::/64");
});

test("pending/active connections obey per-network and total limits with idempotent release", () => {
  const admission = createSocketAdmission({ connectionsPerIp: 1, maxConnections: 2, attemptsPerMinute: 20 });
  const releaseA = admission.acquire(request("192.0.2.1"));
  assert.throws(() => admission.acquire(request("192.0.2.1")), { code: "SOCKET_LIMIT" });
  const releaseB = admission.acquire(request("192.0.2.2"));
  assert.throws(() => admission.acquire(request("192.0.2.3")), { code: "SOCKET_LIMIT" });
  releaseA(); releaseA();
  const releaseC = admission.acquire(request("192.0.2.3"));
  assert.throws(() => admission.acquire(request("192.0.2.4")), { code: "SOCKET_LIMIT" });
  releaseB(); releaseC();
});

test("failed/released sockets and reauthentication share a per-minute attempt budget", () => {
  let clock = 0;
  const admission = createSocketAdmission({ attemptsPerMinute: 2, now: () => clock });
  admission.acquire(request("192.0.2.1"))();
  admission.checkAttempt(request("192.0.2.1"));
  assert.throws(() => admission.acquire(request("192.0.2.1")), { code: "SOCKET_LIMIT" });
  clock = 60001;
  admission.acquire(request("192.0.2.1"))();
});

test("tracking storage is bounded and expired inactive networks free capacity", () => {
  let clock = 0;
  const admission = createSocketAdmission({ maxTrackedIps: 1, now: () => clock });
  const release = admission.acquire(request("192.0.2.1"));
  assert.throws(() => admission.acquire(request("192.0.2.2")), { code: "SOCKET_LIMIT" });
  release(); clock = 60001;
  admission.acquire(request("192.0.2.2"))();
});
