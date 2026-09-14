import { backup, DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readConfig } from './config'

export async function backupDatabase(
  source: string,
  destinationDirectory: string
): Promise<string> {
  // Read-only open fails for a missing source and never runs migrations or creates it.
  const db = new DatabaseSync(source, { readOnly: true })
  let directory: string | undefined
  let complete = false
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const root = resolve(destinationDirectory)
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    directory = mkdtempSync(join(root, `pricedesk-${timestamp}-`))
    const partial = join(directory, 'backup.partial.sqlite')
    // A private, unique directory prevents overwriting a previous backup or the source.
    await backup(db, partial)
    chmodSync(partial, 0o600)
    const check = new DatabaseSync(partial, { readOnly: true })
    try {
      if (check.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok')
        throw new Error('Backup integrity check failed')
      if (check.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Backup foreign key check failed')
    } finally {
      check.close()
    }
    const destination = join(directory, 'pricedesk.sqlite')
    renameSync(partial, destination)
    complete = true
    return destination
  } finally {
    db.close()
    if (directory && !complete) rmSync(directory, { recursive: true, force: true })
  }
}

if (require.main === module) {
  process.umask(0o077)
  void (async () => {
    if (process.argv.length !== 3)
      throw new Error('Usage: pnpm run backup /absolute/backup-directory')
    console.log(await backupDatabase(readConfig().databasePath, process.argv[2]))
  })().catch((error) => {
    console.error('SQLite backup failed', error)
    process.exitCode = 1
  })
}
