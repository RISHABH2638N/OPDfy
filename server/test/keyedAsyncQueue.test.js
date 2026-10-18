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
