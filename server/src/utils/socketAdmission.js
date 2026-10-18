import { isIP } from "node:net";
import { runtimeConfig } from "./runtimeConfig.js";

// Follow the same numeric trusted-proxy hop policy as HTTP; ignore untrusted XFF.
export function socketClientKey(request, trustedHops = Number(process.env.TRUST_PROXY_HOPS || 0)) {
  let address = String(request?.socket?.remoteAddress || "");
  const forwarded = String(request?.headers?.["x-forwarded-for"] || "").split(",").map((part) => part.trim());
  if (Number.isInteger(trustedHops) && trustedHops > 0 && forwarded.every((part) => isIP(part))) {
    address = forwarded[Math.max(0, forwarded.length - trustedHops)];
  }
  address = address.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) {
    // Group IPv6 clients by /64 so rotating addresses cannot bypass one network's budget.
    address = address.replace(/\d+\.\d+\.\d+\.\d+$/, (ipv4) => {
      const bytes = ipv4.split(".").map(Number);
      return `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
    });
    const [head, tail] = address.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const parts = address.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
    return parts.slice(0, 4).map((part) => parseInt(part, 16).toString(16)).join(":") + "::/64";
  }
  return "unknown-network";
}

export function createSocketAdmission({
  attemptsPerMinute = runtimeConfig.socketAttemptsPerMinute,
  connectionsPerIp = runtimeConfig.socketConnectionsPerIp,
  maxConnections = runtimeConfig.socketConnectionsTotal,
  maxTrackedIps = 5000,
  now = Date.now,
} = {}) {
  const networks = new Map();
  let active = 0;
  let nextSweep = 0;
  const denied = () => Object.assign(new Error("Too many realtime connections. Please try again shortly."), { code: "SOCKET_LIMIT", retryAfter: 60 });

  function checkAttempt(request) {
    const at = now();
    if (at >= nextSweep) {
      for (const [key, value] of networks) if (!value.active && value.resetAt <= at) networks.delete(key);
      nextSweep = at + 60000;
    }
    const key = socketClientKey(request);
    let state = networks.get(key);
    if (!state) {
      if (networks.size >= maxTrackedIps) throw denied();
      state = { active: 0, attempts: 0, resetAt: at + 60000 };
      networks.set(key, state);
    }
    if (state.resetAt <= at) { state.attempts = 0; state.resetAt = at + 60000; }
    if (++state.attempts > attemptsPerMinute) throw denied();
    return state;
  }

  return {
    checkAttempt,
    acquire(request) {
      const state = checkAttempt(request);
      if (state.active >= connectionsPerIp || active >= maxConnections) throw denied();
      state.active += 1;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        state.active -= 1;
        active -= 1;
      };
    },
  };
}
