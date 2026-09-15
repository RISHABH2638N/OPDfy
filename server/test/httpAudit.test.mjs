import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApplication } from '../src/app.js';

test('HTTP security boundaries work without a database connection', async t => {
  const { server, io } = createApplication();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await t.test('liveness succeeds while database readiness fails closed', async () => {
      assert.equal((await fetch(base + '/health/live')).status, 200);
      assert.equal((await fetch(base + '/health/ready')).status, 503);
    });
    await t.test('unknown browser origin is rejected', async () => {
      const response = await fetch(base + '/health/live', { headers: { Origin: 'https://untrusted.invalid' } });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    });
    await t.test('private platform backup and patient endpoints reject anonymous access', async () => {
      for (const route of ['/api/platform/backup-recovery', '/api/patient-auth/me', '/api/privacy/me']) {
        const response = await fetch(base + route);
        assert.equal(response.status, 401, route);
        assert.match(response.headers.get('cache-control'), /no-store/);
      }
    });
    await t.test('security headers are present and technology header is absent', async () => {
      const response = await fetch(base + '/health/live');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    });
    await t.test('oversized and MongoDB operator payloads are rejected before database work', async () => {
      const send = body => fetch(base + '/api/patient-auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await send({ email: 'x'.repeat(1100000) })).status, 413);
      assert.equal((await send({ email: { $ne: null } })).status, 400);
    });
  } finally { await new Promise(resolve => io.close(resolve)); }
});
