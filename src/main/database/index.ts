import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { migrateDatabase } from './migrations'

export function openDatabase(userDataPath: string): Database.Database {
  mkdirSync(userDataPath, { recursive: true })
  const database = new Database(join(userDataPath, 'pricedesk.sqlite'))
  try {
    migrateDatabase(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
