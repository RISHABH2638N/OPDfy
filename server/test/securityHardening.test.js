import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";

process.env.NODE_ENV = "test";
process.env.TRUST_PROXY_HOPS = "1";
process.env.SOCKET_CONNECTIONS_PER_IP = "2";
const { default: platformRouter } = await import("../src/routes/platformRoutes.js");
const { default: SuperAdmin } = await import("../src/models/SuperAdmin.js");
const { default: Tenant } = await import("../src/models/Tenant.js");
const { default: Token } = await import("../src/models/Token.js");
const { default: SecurityEvent } = await import("../src/models/SecurityEvent.js");
const { sensitiveAccessAudit } = await import("../src/middleware/sensitiveAccessAudit.js");
const { installRealtimeGateway } = await import("../src/services/realtimeGateway.js");
const { requestAbortSignal } = await import("../src/utils/httpSafety.js");
const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });

test("Super Admin login blocks repeated account failures across IPs and email casing", async t => {
  const find = t.mock.method(SuperAdmin, "findOne", () => ({ select: async () => null }));
  t.mock.method(SecurityEvent, "create", async () => ({}));
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/platform", platformRouter);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/platform/auth/login`;
  const login = async (ip, email) => {
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify({ email, password: "synthetic-wrong-password" }) });
    await response.arrayBuffer(); return response;
  };
  try {
    for (let i = 1; i <= 5; i++) assert.equal((await login(`198.51.100.${i}`, i % 2 ? " Owner@Example.invalid " : "owner@example.invalid")).status, 401);
    const blocked = await login("198.51.100.6", "OWNER@example.invalid");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(find.mock.callCount(), 5, "blocked attempt must not query credentials");
    assert.equal((await login("198.51.100.7", "different-owner@example.invalid")).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("real Socket.IO admission blocks excess anonymous sockets before tenant queries and releases on disconnect", async t => {
  const lookups = t.mock.method(Tenant, "findOne", () => query({ _id: "synthetic-clinic", status: "active", subscription: {} }));
  t.mock.method(Token, "find", () => query([]));
  const server = createServer();
  const io = new Server(server);
  installRealtimeGateway(io);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const sockets = [];
  const open = (clinicSlug = "synthetic-clinic") => new Promise((resolve, reject) => {
    const socket = connect(`http://127.0.0.1:${server.address().port}`, { autoConnect: false, transports: ["websocket"], reconnection: false, timeout: 1500, auth: { clinicSlug } });
    sockets.push(socket);
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
    socket.connect();
  });
  try {
    // Failed middleware must not consume a concurrent connection slot.
    await assert.rejects(open("not a slug"), /unavailable/);
    const first = await open();
    await open();
    await assert.rejects(open(), error => error.data?.code === "SOCKET_LIMIT");
    assert.equal(lookups.mock.callCount(), 2);
    const disconnected = once(io.sockets.sockets.get(first.id), "disconnect");
    first.disconnect(); await disconnected;
    const replacement = await open();
    assert.equal(replacement.connected, true);
    assert.equal(lookups.mock.callCount(), 3);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise(resolve => io.close(resolve));
  }
});

test("authorized queue, appointment, referral and consent reads are audited without query strings or response content", async t => {
  const records = [];
  t.mock.method(SecurityEvent, "create", async record => { records.push(record); return {}; });
  const paths = ["/api/tokens/private", "/api/reception/appointments/today", "/api/tokens/doctor/appointments", "/api/referrals", "/api/clinical-consents"];
  const finish = (path, statusCode, user) => {
    const res = new EventEmitter(); res.statusCode = statusCode;
    sensitiveAccessAudit({ method: "GET", originalUrl: `${path}?name=private-name&diagnosis=private-condition`, tenantId: "synthetic-clinic", user }, res, () => {});
    res.emit("finish");
  };
  for (const path of paths) {
    finish(path, 200, { id: "staff-id" });
    finish(path, 403, { id: "staff-id" });
    finish(path, 200, undefined);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(records.length, paths.length);
  assert.ok(records.every(record => record.event === "patient_data_access" && !JSON.stringify(record).includes("private-")));
});

test("HTTP disconnect signals abort waiting bookings; normal responses do not abort", () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  const signal = requestAbortSignal(req, res);
  res.emit("close");
  assert.equal(signal.aborted, true);
  assert.equal(req.listenerCount("aborted"), 0);
  const req2 = new EventEmitter();
  const res2 = new EventEmitter();
  const complete = requestAbortSignal(req2, res2);
  res2.writableEnded = true;
  res2.emit("finish"); res2.emit("close");
  assert.equal(complete.aborted, false);
  assert.equal(res2.listenerCount("close"), 0);
});
