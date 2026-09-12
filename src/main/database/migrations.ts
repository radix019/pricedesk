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
  },
  (database) => {
    database.exec(`
      CREATE TABLE quotes (
        id INTEGER PRIMARY KEY,
        customerName TEXT NOT NULL CHECK(length(trim(customerName)) BETWEEN 1 AND 200),
        createdAt TEXT NOT NULL,
        subtotalPaise INTEGER NOT NULL CHECK(subtotalPaise >= 0),
        discountPaise INTEGER NOT NULL CHECK(discountPaise >= 0 AND discountPaise <= subtotalPaise),
        totalPaise INTEGER NOT NULL CHECK(totalPaise = subtotalPaise - discountPaise)
      ) STRICT;
      CREATE TABLE quote_items (
        quoteId INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        productId INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        unitPricePaise INTEGER NOT NULL CHECK(unitPricePaise >= 0),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        lineTotalPaise INTEGER NOT NULL CHECK(lineTotalPaise = unitPricePaise * quantity),
        PRIMARY KEY (quoteId, productId)
      ) STRICT;
    `)
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
