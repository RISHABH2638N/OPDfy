import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runMongoTool } from '../src/utils/mongoTools.js';
import { validateCollectionCounts, validateCollectionMatch, validateEncryptedManifest, verifyBackupArchive } from '../src/utils/privacyBackupIntegrity.js';

test('MongoDB tools receive credentials through a private temporary config, then remove it', () => {
  let config;
  const uri = 'mongodb://audit-user:test-only-password@localhost/disposable';
  const result = runMongoTool('mongodump', uri, ['--db', 'disposable'], (command, args, options) => {
    assert.equal(command, 'mongodump');
    assert.ok(args.every(arg => !arg.includes('test-only-password')));
    assert.equal(args[0], '--config');
    config = args[1];
    assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).uri, uri);
    if (process.platform !== 'win32') assert.equal(fs.statSync(config).mode & 0o777, 0o600);
    assert.equal(options.shell, false);
    return { status: 0 };
  });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(config), false);
});

test('tool failure and thrown spawn errors still remove the credential file', () => {
  for (const throws of [false, true]) {
    let config;
    const run = () => runMongoTool('missing-tool', 'mongodb://localhost/test', [], (_, args) => {
      config = args[1];
      if (throws) throw new Error('spawn failed');
      return { status: 1 };
    });
    if (throws) assert.throws(run, /spawn failed/);
    else assert.equal(run().status, 1);
    assert.equal(fs.existsSync(config), false);
  }
});

test('empty or invalid backup inventories cannot be certified as a successful backup', () => {
  for (const counts of [undefined, null, {}, [], { patients: -1 }, { patients: 1.2 }, { patients: '2' }]) {
    assert.throws(() => validateCollectionCounts(counts), { code: 'BACKUP_EMPTY_DATABASE' });
  }
  assert.deepEqual(validateCollectionCounts({ patients: 0 }), { patients: 0 });
});

test('restore inventory requires exact collection names and counts', () => {
  assert.doesNotThrow(() => validateCollectionMatch({ a: 1, b: 2 }, { b: 2, a: 1 }));
  for (const counts of [{ a: 1 }, { a: 1, b: 3 }, { a: 1, b: 2, extra: 0 }]) {
    assert.throws(() => validateCollectionMatch({ a: 1, b: 2 }, counts), { code: 'BACKUP_COUNT_MISMATCH' });
  }
});

test('encrypted manifest must match the trusted database record, not just itself', () => {
  const backup = { database: 'audit', archiveSha256: 'a'.repeat(64), encryptedSha256: 'b'.repeat(64), bytes: 100, encryption: { keyId: 'key1' } };
  const manifest = { format: 'opd-encrypted-mongodb-backup-v2', database: 'audit', sha256: backup.archiveSha256, encryptedSha256: backup.encryptedSha256, encryptedBytes: 100, encryption: { algorithm: 'AES-256-GCM', keyId: 'key1' }, collectionCounts: { patients: 1 } };
  assert.equal(validateEncryptedManifest(manifest, backup), manifest);
  for (const changed of [{ database: 'other' }, { sha256: 'c'.repeat(64) }, { encryptedSha256: 'd'.repeat(64) }, { encryptedBytes: 101 }, { encryption: { algorithm: 'AES-256-GCM', keyId: 'other' } }]) {
    assert.throws(() => validateEncryptedManifest({ ...manifest, ...changed }, backup), { code: 'BACKUP_INTEGRITY_FAILED' });
  }
});

test('archive verification rejects altered bytes and missing inventories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opd-integrity-test-'));
  const archive = path.join(dir, 'backup.archive.gz');
  try {
    fs.writeFileSync(archive, 'original archive');
    const manifest = { format: 'opd-mongodb-backup-v1', database: 'audit', filename: path.basename(archive), bytes: fs.statSync(archive).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), collectionCounts: { patients: 1 } };
    fs.writeFileSync(archive + '.sha256.json', JSON.stringify(manifest));
    assert.equal((await verifyBackupArchive(archive, 'audit')).database, 'audit');
    fs.writeFileSync(archive, 'tampered archive');
    await assert.rejects(verifyBackupArchive(archive, 'audit'), /checksum or size mismatch/);
    fs.writeFileSync(archive + '.sha256.json', JSON.stringify({ ...manifest, collectionCounts: {} }));
    await assert.rejects(verifyBackupArchive(archive, 'audit'), { code: 'BACKUP_EMPTY_DATABASE' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
