import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("production health probes bypass Mongo-backed limits without exposing diagnostics", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { once } from "node:events";
    import { createApplication } from "./src/app.js";
    const { server, io } = createApplication();
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = "http://127.0.0.1:" + server.address().port;
    const results = [];
    for (const path of ["/health/live", "/api/health", "/health/ready", "/health"]) {
      const response = await fetch(base + path);
      results.push({ path, status: response.status, cache: response.headers.get("cache-control"),
        body: await response.json() });
    }
    await new Promise(resolve => io.close(resolve));
    console.log(JSON.stringify(results));
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 15000,
    env: { ...process.env, NODE_ENV: "production", CLIENT_URL: "https://clinic.example.invalid",
      API_RATE_MAX_PER_MINUTE: "1" } });
  assert.equal(result.status, 0, result.stderr);
  const responses = JSON.parse(result.stdout.trim());
  for (const entry of responses) assert.equal(entry.cache, "no-store");
  for (const entry of responses.slice(0, 2)) {
    assert.equal(entry.status, 200, entry.path);
    assert.deepEqual(entry.body, { ok: true });
  }
  for (const entry of responses.slice(2)) {
    assert.equal(entry.status, 503, entry.path);
    assert.equal(entry.body.ok, false);
  }
});
