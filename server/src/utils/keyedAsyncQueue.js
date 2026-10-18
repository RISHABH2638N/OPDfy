/**
 * Per-process FIFO for a shared hot MongoDB document.
 * This is a throughput optimization, NOT a distributed capacity lock.
 * The transactional doctor-document write stays authoritative across replicas.
 */
const tails = new Map();

export async function withKeyedQueue(key, task) {
  if (typeof task !== "function") throw new TypeError("task must be a function");
  const name = String(key);
  const prior = tails.get(name) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prior.then(() => gate);
  tails.set(name, tail);

  await prior;
  try {
    return await task();
  } finally {
    release();
    // Delete only if this operation is still the last waiter for its key.
    if (tails.get(name) === tail) tails.delete(name);
  }
}
