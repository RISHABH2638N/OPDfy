import { AsyncLocalStorage } from "node:async_hooks";

// Per-process coalescer ONLY. The database transaction is authoritative
// across Node processes. Never use this in-memory queue as a capacity lock.
const queues = new Map();
let pendingTotal = 0;

function boundedInt(value, fallback, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export const batchConfig = Object.freeze({
  size: boundedInt(process.env.BOOKING_BATCH_SIZE, 10, 20),
  windowMs: boundedInt(process.env.BOOKING_BATCH_WINDOW_MS, 20, 200),
  maxPerKey: boundedInt(process.env.BOOKING_BATCH_MAX_PENDING_PER_DOCTOR, 120, 500),
  maxTotal: boundedInt(process.env.BOOKING_BATCH_MAX_PENDING_TOTAL, 300, 1000),
  waitMs: boundedInt(process.env.BOOKING_BATCH_WAIT_MS, 25000, 120000),
});

function busy(code) {
  return Object.assign(new Error("Booking is busy. Please check existing bookings before trying again."),
    { status: 503, code, retryAfter: 5 });
}

async function drain(key, queue) {
  if (queue.running || !queue.waiting.length) return;
  clearTimeout(queue.startTimer);
  queue.startTimer = null;
  queue.running = true;
  const batch = queue.waiting.splice(0, batchConfig.size);
  const started = performance.now();
  for (const item of batch) {
    item.started = true;
    item.queueWaitMs = started - item.enqueuedAt;
    item.cleanup();
  }
  try {
    // Async context for the same tenant is preserved. The queue key must
    // contain tenantId; cross-tenant requests must never share a batch.
    const results = await batch[0].run(() => batch[0].handler(batch.map((item) => item.payload)));
    if (!Array.isArray(results) || results.length !== batch.length) {
      throw new Error("Batch handler returned an invalid number of results.");
    }
    for (let i = 0; i < batch.length; i++) {
      const result = results[i];
      try { batch[i].onSettled?.({ waitMs: batch[i].queueWaitMs, batchSize: batch.length, outcome: result }); }
      catch { /* diagnostic logging must never break a booking */ }
      if (result?.error) batch[i].reject(result.error);
      else batch[i].resolve(result?.value);
    }
  } catch (error) {
    for (const item of batch) {
      try { item.onSettled?.({ waitMs: item.queueWaitMs, batchSize: batch.length, outcome: { error } }); }
      catch { /* diagnostic logging must never break a booking */ }
      item.reject(error);
    }
  } finally {
    pendingTotal -= batch.length;
    queue.running = false;
    if (queue.waiting.length) void drain(key, queue);
    else if (queues.get(key) === queue) queues.delete(key);
  }
}

/**
 * Collects work under a tenant:doctor:date key, settling each caller independently.
 * Handler must return one {value} or {error} outcome per input, in input order.
 * Aborting a waiting request prevents execution; an executing DB transaction is
 * never interrupted, because the client may have disconnected after commit.
 */
export function submitKeyedBatch(key, payload, handler, { signal, onSettled } = {}) {
  if (typeof handler !== "function") return Promise.reject(new TypeError("Batch handler must be a function."));
  if (signal?.aborted) return Promise.reject(busy("BOOKING_REQUEST_ABORTED"));
  const name = String(key);
  const queue = queues.get(name) || { waiting: [], running: false, startTimer: null };
  const activeCount = queue.waiting.length + Number(queue.running);
  if (activeCount >= batchConfig.maxPerKey || pendingTotal >= batchConfig.maxTotal) {
    return Promise.reject(busy("BOOKING_BUSY"));
  }
  queues.set(name, queue);
  pendingTotal += 1;
  return new Promise((resolve, reject) => {
    const item = {
      payload, handler, onSettled, resolve, reject, run: AsyncLocalStorage.snapshot(),
      started: false, enqueuedAt: performance.now(), queueWaitMs: 0,
    };
    let timeout;
    const remove = (error) => {
      if (item.started) return;
      const index = queue.waiting.indexOf(item);
      if (index < 0) return;
      queue.waiting.splice(index, 1);
      pendingTotal -= 1;
      item.cleanup();
      reject(error);
      if (!queue.running && !queue.waiting.length) {
        clearTimeout(queue.startTimer);
        if (queues.get(name) === queue) queues.delete(name);
      }
    };
    const abort = () => remove(busy("BOOKING_REQUEST_ABORTED"));
    item.cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
    queue.waiting.push(item);
    timeout = setTimeout(() => remove(busy("BOOKING_QUEUE_TIMEOUT")), batchConfig.waitMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else if (!queue.running) {
      if (queue.waiting.length >= batchConfig.size) void drain(name, queue);
      else if (!queue.startTimer) {
        queue.startTimer = setTimeout(() => void drain(name, queue), batchConfig.windowMs);
      }
    }
  });
}
