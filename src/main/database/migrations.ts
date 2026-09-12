import type Database from 'better-sqlite3'

const migrations: Array<(database: Database.Database) => void> = [
  (database) => {
    database.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        pricePaise INTEGER NOT NULL CHECK(pricePaise >= 0)
      ) STRICT
    `)
    const insert = database.prepare('INSERT INTO products (sku, name, pricePaise) VALUES (?, ?, ?)')
    insert.run('PD-001', 'Notebook', 9900)
    insert.run('PD-002', 'Ballpoint pen', 1500)
    insert.run('PD-003', 'Desk organiser', 34900)
  }
]

export function migrateDatabase(database: Database.Database): void {
  database
    .transaction(() => {
      const version = database.pragma('user_version', { simple: true }) as number
      if (version > migrations.length) {
        throw new Error('This database was created by a newer version of PriceDesk')
      }
      for (let index = version; index < migrations.length; index++) {
        migrations[index](database)
        database.pragma(`user_version = ${index + 1}`)
      }
    })
    .immediate()
}
