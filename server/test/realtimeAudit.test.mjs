import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

async function harness() {
  let resolveMember;
  const membership = new Promise(resolve => { resolveMember = resolve; });
  let onConnection;
  const handlers = new Map(), events = [];
  const account = { _id: 'global-patient', tokenVersion: 0 };
  const context = vm.createContext({ console, Date, setTimeout, clearTimeout, setInterval, clearInterval });
  const dependencies = {
    '../models/Tenant.js': { default: {} },
    '../models/User.js': { default: {} },
    '../models/GlobalPatient.js': { default: { findOne: () => ({ select: async () => account }) } },
    '../models/Token.js': { default: { find: () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] }) } },
    '../utils/sessionTokens.js': { verifySessionToken: () => ({ id: account._id, role: 'patient-global', ver: 0, exp: Math.floor(Date.now()/1000)+600 }) },
    './tenantExecutionContext.js': { runWithTenant: (_, action) => Promise.resolve(action()) },
    './patientMembershipService.js': { resolvePatientMembership: () => membership },
  };
  const module = new vm.SourceTextModule(readFileSync(new URL('../src/services/realtimeGateway.js', import.meta.url), 'utf8'), { context });
  await module.link(name => {
    const exports = dependencies[name];
    return new vm.SyntheticModule(Object.keys(exports), function() {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  module.namespace.installRealtimeGateway({ use() {}, on(_, callback) { onConnection = callback; } });
  const socket = {
    connected: true, data: { tenantId: 'clinic-a' }, rooms: new Set(['socket-id']),
    join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); },
    on(name, callback) { handlers.set(name, callback); },
    emit(name, value) { events.push({ name, value }); },
    disconnect() { this.connected = false; handlers.get('disconnect')?.(); },
  };
  onConnection(socket);
  return { socket, handlers, events, resolveMember };
}

for (const interruption of ['patient:logout', 'disconnect']) {
  test(`delayed patient authentication cannot rejoin private rooms after ${interruption}`, async () => {
    const h = await harness();
    try {
      const pending = h.handlers.get('patient:authenticate')('test-token');
      await Promise.resolve();
      if (interruption === 'disconnect') h.socket.disconnect();
      else h.handlers.get(interruption)();
      h.resolveMember({ _id: 'clinic-patient' });
      await pending;
      assert.equal(h.socket.data.session, undefined);
      assert.equal(h.socket.data.patientId, undefined);
      assert.equal([...h.socket.rooms].some(room => /^(patient:|tenant:|session:)/.test(room)), false);
      assert.equal(h.events.some(event => event.name === 'patient:authenticated'), false);
    } finally { h.socket.disconnect(); }
  });
}

test('successful patient authentication still joins only the resolved patient and clinic rooms', async () => {
  const h = await harness();
  try {
    const pending = h.handlers.get('patient:authenticate')('test-token');
    h.resolveMember({ _id: 'clinic-patient' });
    await pending;
    assert.ok(h.socket.rooms.has('patient:clinic-patient'));
    assert.ok(h.socket.rooms.has('tenant:clinic-a'));
    assert.ok(h.socket.rooms.has('session:patient:global-patient'));
    assert.ok(h.events.some(event => event.name === 'patient:authenticated'));
    h.handlers.get('patient:logout')();
    assert.equal(h.socket.rooms.has('patient:clinic-patient'), false);
  } finally { h.socket.disconnect(); }
});
