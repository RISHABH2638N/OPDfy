import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export function verifySessionToken(token, secret = process.env.JWT_SECRET) {
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (!decoded || typeof decoded !== "object" || !Number.isFinite(decoded.exp) ||
      (decoded.id && !mongoose.isObjectIdOrHexString(decoded.id))) {
    throw new jwt.JsonWebTokenError("Invalid session claims.");
  }
  return decoded;
}

export function revokeSocketSessions(io, kind, id) {
  if (!io) return;
  const room = `session:${kind}:${String(id)}`;
  io.to(room).emit("session:expired", { kind });
  io.in(room).disconnectSockets(true);
}
