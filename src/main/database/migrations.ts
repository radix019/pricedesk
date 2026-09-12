import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

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
  },
  (database) => {
    database.exec('ALTER TABLE quotes ADD COLUMN globalId TEXT')
    const update = database.prepare('UPDATE quotes SET globalId = ? WHERE id = ?')
    for (const row of database.prepare<[], { id: number }>('SELECT id FROM quotes').all()) {
      update.run(randomUUID(), row.id)
    }
    database.exec(`
      CREATE UNIQUE INDEX quotes_global_id ON quotes(globalId);
      CREATE TRIGGER quotes_require_global_id BEFORE INSERT ON quotes
      WHEN NEW.globalId IS NULL OR length(NEW.globalId) != 36
      BEGIN SELECT RAISE(ABORT, 'Quote requires a global ID'); END;
      CREATE TRIGGER quotes_immutable_global_id BEFORE UPDATE OF globalId ON quotes
      BEGIN SELECT RAISE(ABORT, 'Global ID is immutable'); END;
      CREATE TABLE quote_outbox (
        operationId TEXT PRIMARY KEY NOT NULL,
        quoteId INTEGER NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE RESTRICT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'synced', 'failed')),
        attemptCount INTEGER NOT NULL DEFAULT 0 CHECK(attemptCount >= 0),
        nextRetryAt INTEGER,
        lastError TEXT,
        acknowledgement TEXT
      ) STRICT;
      CREATE INDEX quote_outbox_due ON quote_outbox(status, nextRetryAt);
      CREATE TRIGGER quote_outbox_immutable BEFORE UPDATE OF operationId, quoteId, payload ON quote_outbox
      BEGIN SELECT RAISE(ABORT, 'Upload payload is immutable'); END;
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
