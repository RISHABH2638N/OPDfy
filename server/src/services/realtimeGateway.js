import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import GlobalPatient from "../models/GlobalPatient.js";
import Token from "../models/Token.js";
import { verifySessionToken } from "../utils/sessionTokens.js";
import { runWithTenant } from "./tenantExecutionContext.js";
import { resolvePatientMembership } from "./patientMembershipService.js";

export function tenantIsAvailable(tenant, now = Date.now()) {
  return Boolean(tenant && tenant.status === "active" &&
    (!tenant.subscription?.endsAt || new Date(tenant.subscription.endsAt).getTime() > now));
}

export function installRealtimeGateway(io) {
  io.use(async (socket, next) => {
    try {
      const slug = String(socket.handshake.auth?.clinicSlug || "").trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error();
      const tenant = await Tenant.findOne({ slug }).select("_id status subscription.endsAt").lean();
      if (!tenantIsAvailable(tenant)) throw new Error();
      socket.data.tenantId = String(tenant._id);
      Object.assign(socket.data, await authenticate(socket, socket.handshake.auth || {}));
      next();
    } catch {
      next(new Error("Clinic or session is unavailable."));
    }
  });

  async function authenticate(socket, auth) {
    const tenantId = socket.data.tenantId;
    const token = auth.staffToken || auth.patientToken;
    if (!token) return {};
    let patientId;
    const decoded = verifySessionToken(token);
    const staff = Boolean(auth.staffToken);
    if (staff) {
      if (decoded.tenantId !== tenantId || !["admin", "doctor", "receptionist"].includes(decoded.role)) throw new Error();
      const account = await runWithTenant(tenantId, () => User.findById(decoded.id).select("role +tokenVersion").lean());
      if (!account || account.role !== decoded.role || Number(decoded.ver || 0) !== Number(account.tokenVersion || 0)) throw new Error();
    } else {
      if (decoded.role !== "patient-global") throw new Error();
      const account = await GlobalPatient.findOne({ _id: decoded.id, status: "active" }).select("+tokenVersion");
      if (!account || Number(decoded.ver || 0) !== Number(account.tokenVersion || 0)) throw new Error();
      // Load the complete authorized profile before membership synchronization.
      const member = await resolvePatientMembership({ tenantId, globalPatient: account });
      if (!member) throw new Error();
      patientId = String(member._id);
    }
    return { patientId, session: { id: decoded.id, kind: staff ? "staff" : "patient", ver: Number(decoded.ver || 0), exp: decoded.exp, role: decoded.role } };
  }

  function clearPrivateRooms(socket) {
    socket.data.authGeneration = (socket.data.authGeneration || 0) + 1;
    for (const room of socket.rooms) {
      if (/^(patient:|tenant:|session:)/.test(room)) socket.leave(room);
    }
    clearTimeout(socket.data.expiryTimer);
    delete socket.data.session;
    delete socket.data.patientId;
  }

  function expire(socket) {
    socket.emit("session:expired", { kind: socket.data.session?.kind });
    clearPrivateRooms(socket);
    socket.disconnect(true);
  }

  function joinPrivateRooms(socket) {
    const session = socket.data.session;
    if (!session) return;
    socket.join(`tenant:${socket.data.tenantId}`);
    socket.join(`session:${session.kind}:${session.id}`);
    if (socket.data.patientId) socket.join(`patient:${socket.data.patientId}`);
    socket.data.expiryTimer = setTimeout(() => expire(socket), Math.max(0, Math.min(session.exp * 1000 - Date.now(), 2147483647)));
    socket.data.expiryTimer.unref?.();
  }

  io.on("connection", (socket) => {
    const tenantId = socket.data.tenantId;
    socket.join(`public:${tenantId}`);
    joinPrivateRooms(socket);
    runWithTenant(tenantId, async () => {
      const queue = await Token.find({ isArchived: { $ne: true } })
        .select("tokenNumber department status urgency -_id").sort({ department: 1, tokenNumber: 1 }).lean();
      socket.emit("queue:updated", queue);
    }).catch(() => socket.disconnect(true));

    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const tenant = await Tenant.findById(tenantId).select("status subscription.endsAt").lean();
        if (!tenantIsAvailable(tenant)) return expire(socket);
        const session = socket.data.session;
        if (!session) return;
        const account = session.kind === "staff"
          ? await runWithTenant(tenantId, () => User.findById(session.id).select("role +tokenVersion").lean())
          : await GlobalPatient.findOne({ _id: session.id, status: "active" }).select("+tokenVersion").lean();
        if (!account || session.ver !== Number(account.tokenVersion || 0) ||
            (session.kind === "staff" && account.role !== session.role)) expire(socket);
      } catch { expire(socket); } finally { checking = false; }
    }, 15000);
    timer.unref?.();

    let authenticating = false;
    let lastAuth = 0;
    socket.on("patient:authenticate", async (token) => {
      if (authenticating || Date.now() - lastAuth < 1000) return;
      authenticating = true;
      lastAuth = Date.now();
      clearPrivateRooms(socket);
      const generation = socket.data.authGeneration;
      try {
        if (typeof token !== "string" || !token || token.length > 8192) throw new Error();
        const identity = await authenticate(socket, { patientToken: token });
        if (!socket.connected || socket.data.authGeneration !== generation) return;
        Object.assign(socket.data, identity);
        joinPrivateRooms(socket);
        socket.emit("patient:authenticated");
      } catch {
        if (socket.data.authGeneration !== generation) return;
        clearPrivateRooms(socket);
        socket.emit("patient:authentication-failed");
      } finally { authenticating = false; }
    });
    socket.on("patient:logout", () => clearPrivateRooms(socket));
    socket.on("disconnect", () => { clearInterval(timer); clearPrivateRooms(socket); });
  });
}
