import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const latestVersion = 1

function readSchemaVersion(db: DatabaseSync): number {
  const version = db.prepare('PRAGMA user_version').get()!.user_version as number
  if (version > latestVersion) throw new Error('API database is newer than this server')
  return version
}

export function isDatabaseBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('errcode' in error)) return false
  return typeof error.errcode === 'number' && [5, 6].includes(error.errcode & 0xff)
}

export function rollbackAfterError(db: DatabaseSync): void {
  if (db.isTransaction === false) return
  try {
    db.exec('ROLLBACK')
  } catch {
    // BEGIN may have failed, or SQLite may have rolled back automatically.
    // Cleanup must not replace the original database error.
  }
}

export function openApiDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000')
    if (readSchemaVersion(db) === latestVersion) return db
    db.exec('BEGIN IMMEDIATE')
    const version = readSchemaVersion(db)
    if (version === 0)
      db.exec(`
      CREATE TABLE quotes (
        globalId TEXT PRIMARY KEY NOT NULL,
        snapshot TEXT NOT NULL,
        priceStatus TEXT NOT NULL CHECK(priceStatus = 'draft'),
        subtotalPaise INTEGER NOT NULL CHECK(subtotalPaise >= 0),
        discountPaise INTEGER NOT NULL CHECK(discountPaise BETWEEN 0 AND subtotalPaise),
        totalPaise INTEGER NOT NULL CHECK(totalPaise = subtotalPaise - discountPaise)
      ) STRICT;
      CREATE TABLE receipts (
        operationId TEXT PRIMARY KEY NOT NULL,
        quoteId TEXT NOT NULL UNIQUE REFERENCES quotes(globalId),
        payload TEXT NOT NULL,
        acknowledgement TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `)
    db.exec('COMMIT')
    return db
  } catch (error) {
    try {
      rollbackAfterError(db)
    } finally {
      db.close()
    }
    throw error
  }
}
