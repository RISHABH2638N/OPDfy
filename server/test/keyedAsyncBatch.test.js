import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { submitKeyedBatch } from "../src/utils/keyedAsyncBatch.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("many bookings coalesce into fewer batch operations and preserve ordering", async () => {
  const sizes = [];
  const values = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    submitKeyedBatch("tenant:doctor-a:2026-10-19", i, async (group) => {
      sizes.push(group.length);
      await sleep(3);
      return group.map((value) => ({ value: value * 2 }));
    })
  ));
  assert.deepEqual(values, Array.from({ length: 25 }, (_, i) => i * 2));
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), 25);
  assert.ok(sizes.length < 25, `Expected batching, got ${sizes.length} operations`);
});

test("one invalid item does not make other batch items fail", async () => {
  const promise = [0, 1, 2].map((i) => submitKeyedBatch("one-error", i, async (items) =>
    items.map((j) => j === 1 ? { error: new Error("invalid booking") } : { value: j })
  ));
  const result = await Promise.allSettled(promise);
  assert.deepEqual(result.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.match(result[1].reason.message, /invalid booking/);
});

test("different doctors can execute simultaneously", async () => {
  let active = 0;
  let peak = 0;
  const run = (key) => submitKeyedBatch(key, 1, async (values) => {
    active++;
    peak = Math.max(peak, active);
    await sleep(30);
    active--;
    return values.map((v) => ({ value: v }));
  });
  await Promise.all([run("a"), run("b")]);
  assert.equal(peak, 2);
});

test("an aborted waiting request is excluded from the batch", async () => {
  const started = [];
  const first = submitKeyedBatch("abort-key", 1, async (values) => {
    started.push(...values);
    await sleep(50);
    return values.map((value) => ({ value }));
  });
  await sleep(30);
  const controller = new AbortController();
  const second = submitKeyedBatch("abort-key", 2, async (values) => {
    started.push(...values);
    return values.map((value) => ({ value }));
  }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(second, (e) => e.code === "BOOKING_REQUEST_ABORTED");
  assert.equal(await first, 1);
  assert.deepEqual(started, [1]);
});

test("batch handler keeps tenant request AsyncLocalStorage context", async () => {
  const storage = new AsyncLocalStorage();
  const results = await storage.run("tenant-same", () => Promise.all([1, 2, 3].map((i) =>
    submitKeyedBatch("tenant-same:doctor", i, async (values) => values.map((value) =>
      ({ value: `${storage.getStore()}:${value}` })
    ))
  )));
  assert.deepEqual(results, ["tenant-same:1", "tenant-same:2", "tenant-same:3"]);
});

test("handler failure releases queue for subsequent batches", async () => {
  const bad = submitKeyedBatch("retry-key", 1, async () => { throw new Error("db down"); });
  await assert.rejects(bad, /db down/);
  const good = await submitKeyedBatch("retry-key", 5, async (values) => values.map((value) => ({ value })));
  assert.equal(good, 5);
});
