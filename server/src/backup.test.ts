import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabase } from './backup'
import { openApiDatabase } from './database'

test('online backups include committed WAL data and exclude an uncommitted transaction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-backup-test-'))
  const source = join(directory, 'source.sqlite')
  const writer = openApiDatabase(source)
  try {
    writer.exec(`PRAGMA journal_mode = WAL;
      BEGIN IMMEDIATE;
      INSERT INTO quotes VALUES ('quote', '{}', 'draft', 100, 0, 100);
      INSERT INTO receipts VALUES ('operation', 'quote', 'original', 'original');
      COMMIT;
      BEGIN IMMEDIATE;
      UPDATE quotes SET snapshot = 'changed';
      UPDATE receipts SET payload = 'changed';`)
    const first = await backupDatabase(source, join(directory, 'backups'))
    writer.exec('COMMIT')
    const second = await backupDatabase(source, join(directory, 'backups'))
    assert.notEqual(first, second)
    for (const [path, snapshot, payload] of [
      [first, '{}', 'original'],
      [second, 'changed', 'changed']
    ]) {
      const restored = new DatabaseSync(path, { readOnly: true })
      try {
        assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
        assert.equal(restored.prepare('PRAGMA user_version').get()!.user_version, 1)
        assert.equal(restored.prepare('SELECT snapshot FROM quotes').get()!.snapshot, snapshot)
        assert.equal(restored.prepare('SELECT payload FROM receipts').get()!.payload, payload)
        assert.equal(restored.prepare('SELECT count(*) AS n FROM receipts').get()!.n, 1)
        assert.equal(statSync(path).mode & 0o777, 0o600)
      } finally {
        restored.close()
      }
    }
  } finally {
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a backup of a missing source fails without creating a database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-missing-backup-'))
  const source = join(directory, 'missing.sqlite')
  try {
    await assert.rejects(backupDatabase(source, join(directory, 'backups')))
    assert.equal(existsSync(source), false)
    assert.equal(existsSync(join(directory, 'backups')), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
