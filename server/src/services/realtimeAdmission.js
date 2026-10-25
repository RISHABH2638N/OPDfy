import crypto from "node:crypto";
import mongoose from "mongoose";
import { MongoRateLimitStore } from "../utils/rateLimitStore.js";
import { safeDiagnostic } from "../utils/privacySafeLog.js";

const positive = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), 20000) : fallback;
export function realtimeLimits(env = process.env) {
  return { perIp: positive(env.SOCKET_MAX_CONNECTIONS_PER_IP, 200), total: positive(env.SOCKET_MAX_CONNECTIONS, 1000),
    attempts: positive(env.SOCKET_ATTEMPTS_PER_MINUTE, 240), leaseMs: 90000, windowMs: 60000 };
}
const digestIp = ip => crypto.createHash("sha256").update(String(ip)).digest("hex");

export class MongoSocketQuota {
  constructor({ database = () => mongoose.connection.db, limits = realtimeLimits() } = {}) {
    this.database = database; this.limits = limits;
  }
  collection() {
    const db = this.database();
    if (!db) throw new Error("Socket quota database unavailable.");
    return db.collection("realtime_connection_quota");
  }
  async acquire(id, ip) {
    const c = this.collection(), now = new Date(), expiresAt = new Date(Date.now() + this.limits.leaseMs);
    try { await c.updateOne({ _id: "connections" }, { $setOnInsert: { leases: [] } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const active = { $filter: { input: "$leases", as: "lease", cond: { $gt: ["$$lease.expiresAt", now] } } };
    const own = { $filter: { input: active, as: "lease", cond: { $eq: ["$$lease.ip", ip] } } };
    const result = await c.updateOne({ _id: "connections", $expr: { $and: [
      { $lt: [{ $size: active }, this.limits.total] }, { $lt: [{ $size: own }, this.limits.perIp] },
    ] } }, [{ $set: { leases: { $concatArrays: [active, [{ id, ip, expiresAt }]] } } }]);
    return result.modifiedCount === 1;
  }
  async release(id) { await this.collection().updateOne({ _id: "connections" }, { $pull: { leases: { id } } }); }
  async renew(ids) {
    if (!ids.length) return;
    await this.collection().updateOne({ _id: "connections" }, { $set: { "leases.$[lease].expiresAt": new Date(Date.now() + this.limits.leaseMs) } },
      { arrayFilters: [{ "lease.id": { $in: ids } }] });
  }
}

export function createRealtimeAdmission({ resolveIp, limits = realtimeLimits(), distributed = process.env.NODE_ENV === "production", store = null } = {}) {
  const shared = store || (distributed ? new MongoSocketQuota({ limits }) : null);
  const attempts = new Map(), connections = new Map(), pendingReleases = new Set();
  const sharedAttempts = distributed ? new MongoRateLimitStore("socket-handshakes") : null;
  sharedAttempts?.init({ windowMs: limits.windowMs });
  let closed = false, lastRenew = Date.now(), maintaining = false;
  const stats = { rejected: 0, storeFailures: 0 };
  const release = id => {
    const entry = connections.get(id);
    if (!entry) return;
    clearTimeout(entry.timer); connections.delete(id);
    if (shared) {
      const operation = shared.release(id).catch(error => { stats.storeFailures++; console.warn("Socket quota release failed:", safeDiagnostic(error)); });
      pendingReleases.add(operation); operation.finally(() => pendingReleases.delete(operation));
    }
  };
  function countIp(ip) { let count = 0; for (const entry of connections.values()) if (entry.ip === ip) count++; return count; }
  function consume(ip, maximum = limits.attempts, suffix = "attempt") {
    const key = `${suffix}:${ip}`, now = Date.now();
    let entry = attempts.get(key);
    if (!entry || entry.until <= now) {
      if (attempts.size >= 10000) return false;
      entry = { count: 0, until: now + limits.windowMs }; attempts.set(key, entry);
    }
    return ++entry.count <= maximum;
  }
  async function allow(req, callback) {
    let id;
    try {
      const ip = digestIp(resolveIp(req));
      if (closed || !consume(ip) || connections.size >= limits.total || countIp(ip) >= limits.perIp) {
        stats.rejected++; return callback("Connection quota reached. Retry later.", false);
      }
      id = crypto.randomBytes(16).toString("hex");
      // Reserve locally BEFORE awaiting shared storage, bounding pending work.
      connections.set(id, { ip, engine: null, timer: setTimeout(() => release(id), 15000) });
      connections.get(id).timer.unref?.();
      if (sharedAttempts && (await sharedAttempts.increment(ip)).totalHits > limits.attempts) {
        stats.rejected++; release(id); return callback("Connection quota reached. Retry later.", false);
      }
      if (shared && !(await shared.acquire(id, ip))) {
        stats.rejected++; release(id); return callback("Connection quota reached. Retry later.", false);
      }
      if (closed || !connections.has(id)) { if (shared) await shared.release(id); release(id); return callback("Connection unavailable.", false); }
      req.opdfyConnectionLease = id;
      callback(null, true);
    } catch (error) {
      if (id) release(id);
      stats.storeFailures++; console.warn("Socket admission failed:", safeDiagnostic(error));
      callback("Connection admission unavailable.", false);
    }
  }
  function connected(engine) {
    const id = engine.request.opdfyConnectionLease, entry = connections.get(id);
    if (!entry) return engine.close(true);
    clearTimeout(entry.timer); entry.engine = engine;
    engine.once("close", () => release(id));
  }
  async function maintain() {
    if (maintaining || closed) return;
    maintaining = true;
    try {
      for (const [key, entry] of attempts) if (entry.until <= Date.now()) attempts.delete(key);
      if (shared) await shared.renew([...connections.keys()]);
      lastRenew = Date.now();
    } catch (error) {
      stats.storeFailures++; console.warn("Socket quota renewal failed:", safeDiagnostic(error));
      if (Date.now() - lastRenew > limits.leaseMs - 10000) {
        for (const [id, entry] of connections) { entry.engine?.close(true); release(id); }
      }
    } finally { maintaining = false; }
  }
  const timer = setInterval(maintain, 20000); timer.unref?.();
  return { allow, connected,
    // Polling follow-up requests do not consume new connection leases. Their
    // cheap local request budget bounds transport floods without database reads.
    polling(req, res, next) {
      if (req._query?.sid && !consume(digestIp(resolveIp(req)), Math.max(6000, limits.perIp * 120), "poll")) {
        res.writeHead(429, { "Retry-After": "60" }); return res.end();
      }
      next();
    },
    snapshot: () => ({ ...stats, active: connections.size }),
    async close() {
      closed = true; clearInterval(timer);
      for (const id of [...connections.keys()]) release(id);
      await Promise.allSettled([...pendingReleases]); attempts.clear();
    },
  };
}
