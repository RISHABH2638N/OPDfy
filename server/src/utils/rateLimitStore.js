import mongoose from "mongoose";

class MongoRateLimitStore {
  constructor(namespace) {
    this.namespace = String(namespace || "api").replace(/[^a-z0-9_-]/gi, "_");
    this.windowMs = 60000;
    this.indexReady = false;
  }

  init(options) {
    this.windowMs = Number(options?.windowMs || this.windowMs);
  }

  collection() {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      throw new Error("Rate-limit store database is unavailable.");
    }
    const collection = mongoose.connection.db.collection("rate_limit_counters");
    if (!this.indexReady) {
      this.indexReady = true;
      collection.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { this.indexReady = false; });
    }
    return collection;
  }

  async increment(key) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);
    const id = `${this.namespace}:${String(key)}`;
    const document = await this.collection().findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            totalHits: {
              $cond: [
                { $or: [{ $eq: [{ $type: "$resetAt" }, "missing"] }, { $lte: ["$resetAt", now] }] },
                1,
                { $add: [{ $ifNull: ["$totalHits", 0] }, 1] },
              ],
            },
            resetAt: {
              $cond: [
                { $or: [{ $eq: [{ $type: "$resetAt" }, "missing"] }, { $lte: ["$resetAt", now] }] },
                resetAt,
                "$resetAt",
              ],
            },
          },
        },
      ],
      { upsert: true, returnDocument: "after" }
    );
    const value = document?.value || document;
    return { totalHits: Number(value?.totalHits || 1), resetTime: new Date(value?.resetAt || resetAt) };
  }

  async decrement(key) {
    const id = `${this.namespace}:${String(key)}`;
    await this.collection().updateOne({ _id: id, totalHits: { $gt: 0 } }, { $inc: { totalHits: -1 } });
  }

  async resetKey(key) {
    await this.collection().deleteOne({ _id: `${this.namespace}:${String(key)}` });
  }

  async resetAll() {
    await this.collection().deleteMany({ _id: { $regex: `^${this.namespace}:` } });
  }
}

export function createRateLimitStore(namespace) {
  // Development keeps local iteration simple; production counters are shared
  // through MongoDB so restarts/multiple backend instances cannot bypass limits.
  return process.env.NODE_ENV === "production" ? new MongoRateLimitStore(namespace) : undefined;
}
