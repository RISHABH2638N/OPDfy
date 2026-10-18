import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { withKeyedQueue } from "../src/utils/keyedAsyncQueue.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("same doctor/day key enters critical section one at a time", async () => {
  let inFlight = 0;
  let maximum = 0;
  const order = [];
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    withKeyedQueue("clinic:doctor:2026-10-18", async () => {
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      order.push(i);
      await delay(1);
      inFlight -= 1;
      return i;
    })
  ));
  assert.equal(maximum, 1);
  assert.deepEqual(order, Array.from({ length: 25 }, (_, i) => i));
  assert.deepEqual(results, order);
});

test("different doctor keys may run concurrently", async () => {
  let inFlight = 0;
  let maximum = 0;
  await Promise.all(["doctor-a", "doctor-b"].map((key) =>
    withKeyedQueue(key, async () => {
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await delay(10);
      inFlight -= 1;
    })
  ));
  assert.equal(maximum, 2);
});

test("exception releases key for following request", async () => {
  const first = withKeyedQueue("exception-key", async () => { throw new Error("simulated failure"); });
  const second = withKeyedQueue("exception-key", async () => 42);
  await assert.rejects(first, /simulated failure/);
  assert.equal(await second, 42);
});

test("queued operations retain their async request context", async () => {
  const context = new AsyncLocalStorage();
  const tasks = ["tenant-a", "tenant-b", "tenant-c"].map((tenant) =>
    context.run(tenant, () => withKeyedQueue("shared-key", async () => {
      await delay(1);
      return context.getStore();
    }))
  );
  assert.deepEqual(await Promise.all(tasks), ["tenant-a", "tenant-b", "tenant-c"]);
});

test("per-doctor and global limits reject excess work without executing it", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withKeyedQueue("bounded-a", () => gate, { maxPending: 2, maxTotal: 2 });
  const second = withKeyedQueue("bounded-a", () => 2, { maxPending: 2, maxTotal: 2 });
  let unexpected = 0;
  try {
    await assert.rejects(withKeyedQueue("bounded-a", () => unexpected++, { maxPending: 2 }), { status: 503, code: "BOOKING_BUSY" });
    await assert.rejects(withKeyedQueue("bounded-b", () => unexpected++, { maxTotal: 2 }), { status: 503, code: "BOOKING_BUSY" });
    assert.equal(unexpected, 0);
  } finally { release(1); await Promise.all([first, second]); }
  assert.equal(await withKeyedQueue("bounded-a", () => 3, { maxPending: 1, maxTotal: 1 }), 3);
});

test("expired and disconnected waiters are removed and never execute", async () => {
  let release;
  const first = withKeyedQueue("removal", () => new Promise(resolve => { release = resolve; }));
  let unexpected = 0;
  const timeout = withKeyedQueue("removal", () => unexpected++, { waitTimeoutMs: 10 });
  const controller = new AbortController();
  const aborted = withKeyedQueue("removal", () => unexpected++, { signal: controller.signal });
  const timedOut = assert.rejects(timeout, { code: "BOOKING_QUEUE_TIMEOUT" });
  const disconnected = assert.rejects(aborted, { code: "BOOKING_REQUEST_ABORTED" });
  controller.abort();
  try {
    await Promise.all([timedOut, disconnected]);
    const remaining = withKeyedQueue("removal", () => "valid", { maxPending: 2 });
    release();
    await first;
    assert.equal(await remaining, "valid");
    assert.equal(unexpected, 0);
  } finally { release(); await first; }
});

test("disconnecting an executing booking never releases its transaction early", async () => {
  let release;
  const controller = new AbortController();
  const first = withKeyedQueue("transaction", () => new Promise(resolve => { release = resolve; }), { signal: controller.signal });
  controller.abort();
  let entered = false;
  const second = withKeyedQueue("transaction", () => { entered = true; });
  await Promise.resolve();
  assert.equal(entered, false);
  release("committed");
  assert.equal(await first, "committed");
  await second;
  assert.equal(entered, true);
});

test("already aborted requests and invalid limits fail before running a task", async () => {
  const controller = new AbortController(); controller.abort();
  let entered = false;
  await assert.rejects(withKeyedQueue("pre-aborted", () => { entered = true; }, { signal: controller.signal }), { code: "BOOKING_REQUEST_ABORTED" });
  await assert.rejects(withKeyedQueue("invalid-limit", () => {}, { maxPending: 0 }), TypeError);
  assert.equal(entered, false);
});
