import { AsyncLocalStorage } from "node:async_hooks";
import { runtimeConfig } from "./runtimeConfig.js";

// Bounded per-process FIFO. MongoDB transactions remain authoritative across replicas.
const queues = new Map();
let pendingTotal = 0;

function queueError(code, message) {
  return Object.assign(new Error(message), { status: 503, code, retryAfter: 5 });
}

async function drain(name, queue) {
  if (queue.running || !queue.waiting.length) return;
  const item = queue.waiting.shift();
  queue.running = true;
  item.started = true;
  item.cleanup();
  try { item.resolve(await item.run(item.task)); }
  catch (error) { item.reject(error); }
  finally {
    pendingTotal -= 1;
    queue.running = false;
    if (queue.waiting.length) void drain(name, queue);
    else queues.delete(name);
  }
}

export async function withKeyedQueue(key, task, {
  maxPending = runtimeConfig.bookingMaxPendingPerDoctor,
  maxTotal = runtimeConfig.bookingMaxPendingTotal,
  waitTimeoutMs = runtimeConfig.bookingQueueWaitMs,
  signal,
} = {}) {
  if (typeof task !== "function") throw new TypeError("task must be a function");
  if (![maxPending, maxTotal, waitTimeoutMs].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new TypeError("Queue limits must be positive integers");
  }
  if (signal?.aborted) throw queueError("BOOKING_REQUEST_ABORTED", "Booking request was disconnected.");
  const name = String(key);
  const queue = queues.get(name) || { running: false, waiting: [] };
  if (queue.waiting.length + Number(queue.running) >= maxPending || pendingTotal >= maxTotal) {
    throw queueError("BOOKING_BUSY", "Booking is busy. Please check your bookings and try again shortly.");
  }
  queues.set(name, queue);
  pendingTotal += 1;

  return new Promise((resolve, reject) => {
    const item = { task, resolve, reject, run: AsyncLocalStorage.snapshot(), started: false };
    let timer;
    const remove = (error) => {
      if (item.started) return; // Never abandon an executing transaction or release its lock early.
      const index = queue.waiting.indexOf(item);
      if (index < 0) return;
      queue.waiting.splice(index, 1);
      pendingTotal -= 1;
      item.cleanup();
      reject(error);
      if (!queue.running && !queue.waiting.length) queues.delete(name);
    };
    const abort = () => remove(queueError("BOOKING_REQUEST_ABORTED", "Booking request was disconnected."));
    item.cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    queue.waiting.push(item);
    timer = setTimeout(() => remove(queueError("BOOKING_QUEUE_TIMEOUT", "Booking is busy. Please check your bookings and try again shortly.")), waitTimeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else void drain(name, queue);
  });
}
