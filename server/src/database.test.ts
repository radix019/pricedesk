import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openApiDatabase, rollbackAfterError } from './database'

test('startup preserves the original error when opening an invalid database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-invalid-db-'))
  const path = join(directory, 'invalid.sqlite')
  try {
    writeFileSync(path, 'This is not a SQLite database'.repeat(100))
    assert.throws(() => openApiDatabase(path), /file is not a database/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an up-to-date API database opens while another connection holds a write reservation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-open-locked-'))
  const path = join(directory, 'api.sqlite')
  const writer = openApiDatabase(path)
  try {
    writer.exec('BEGIN IMMEDIATE')
    const db = openApiDatabase(path)
    try {
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1)
      assert.equal(db.isTransaction, false)
      assert.equal(db.prepare('SELECT count(*) AS n FROM quotes').get()!.n, 0)
    } finally {
      db.close()
    }
  } finally {
    writer.exec('ROLLBACK')
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('opening a newer schema still fails without changing its version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-newer-schema-'))
  const path = join(directory, 'api.sqlite')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA user_version = 2')
    assert.throws(() => openApiDatabase(path), /API database is newer than this server/)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migration failure rolls back partial schema changes and preserves the original error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-migration-error-'))
  const path = join(directory, 'api.sqlite')
  const setup = new DatabaseSync(path)
  setup.exec('CREATE TABLE receipts (existing TEXT)')
  setup.close()
  try {
    assert.throws(() => openApiDatabase(path), /table receipts already exists/)
    const db = new DatabaseSync(path)
    try {
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 0)
      assert.equal(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'quotes'").get(),
        undefined
      )
      assert.equal(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'receipts'").get()!.name,
        'receipts'
      )
    } finally {
      db.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('error cleanup tolerates an automatic rollback and leaves the connection usable', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE entries (value TEXT);
      CREATE TRIGGER fail_insert BEFORE INSERT ON entries
      BEGIN SELECT RAISE(ROLLBACK, 'Automatic rollback'); END;
      BEGIN IMMEDIATE`)
    assert.throws(() => db.exec("INSERT INTO entries VALUES ('test')"), /Automatic rollback/)
    assert.doesNotThrow(() => rollbackAfterError(db))
    db.exec('DROP TRIGGER fail_insert; BEGIN IMMEDIATE')
    db.exec("INSERT INTO entries VALUES ('recovered'); COMMIT")
    assert.equal(db.prepare('SELECT value FROM entries').get()!.value, 'recovered')
  } finally {
    db.close()
  }
})
