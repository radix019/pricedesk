import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase } from './index'
import { createQuoteRepository } from './quotes'

const input = {
  customerName: ' Customer ',
  discountPaise: 100,
  items: [
    { productId: 1, quantity: 2 },
    { productId: 2, quantity: 1 }
  ]
}

function fixture(): { db: Database.Database; close: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-quotes-'))
  const db = openDatabase(directory)
  return {
    db,
    close: () => {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

test('quotes calculate current prices and preserve snapshots after catalogue edits', () => {
  const { db, close } = fixture()
  try {
    const repo = createQuoteRepository(db)
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(db.pragma('user_version', { simple: true }), 2)
    db.prepare('UPDATE products SET pricePaise = 10001 WHERE id = 1').run()
    const quote = repo.createQuote(input)
    assert.equal(quote.customerName, 'Customer')
    assert.equal(quote.subtotalPaise, 21502)
    assert.equal(quote.totalPaise, 21402)
    db.prepare(
      "UPDATE products SET sku = 'EDIT', name = 'Changed', pricePaise = 1 WHERE id = 1"
    ).run()
    assert.deepEqual(repo.getQuote(quote.id), quote)
    assert.equal(repo.listQuotes()[0].totalPaise, 21402)
    assert.equal(repo.getQuote(99999), null)
    assert.throws(() => db.prepare('DELETE FROM products WHERE id = 1').run(), /FOREIGN KEY/)
    assert.throws(() => repo.getQuote('1'))
  } finally {
    close()
  }
})

test('bad requests and forged prices are rejected without writes', () => {
  const { db, close } = fixture()
  try {
    const repo = createQuoteRepository(db)
    for (const invalid of [
      null,
      { ...input, customerName: ' ' },
      { ...input, discountPaise: 0.1 },
      { ...input, discountPaise: 999999 },
      { ...input, items: [] },
      {
        ...input,
        items: [
          { productId: 1, quantity: 1 },
          { productId: 1, quantity: 2 }
        ]
      },
      { ...input, items: [{ productId: 99999, quantity: 1 }] },
      { ...input, items: [{ productId: 1, quantity: 0 }] },
      { ...input, items: [{ productId: '1', quantity: 1 }] },
      { ...input, items: [{ productId: 1, quantity: 1, unitPricePaise: 1 }] },
      { ...input, subtotalPaise: 1 }
    ])
      assert.throws(() => repo.createQuote(invalid))
    assert.deepEqual(repo.listQuotes(), [])
  } finally {
    close()
  }
})

test('failure on second item rolls back the quote header and first item', () => {
  const { db, close } = fixture()
  try {
    const repo = createQuoteRepository(db)
    db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON quote_items WHEN NEW.productId = 2
      BEGIN SELECT RAISE(ABORT, 'Injected item failure'); END`)
    assert.throws(() => repo.createQuote(input), /Injected item failure/)
    assert.deepEqual(repo.listQuotes(), [])
    assert.equal((db.prepare('SELECT count(*) AS n FROM quote_items').get() as { n: number }).n, 0)
    db.exec('DROP TRIGGER fail_second')
    assert.equal(repo.createQuote(input).items.length, 2)
  } finally {
    close()
  }
})

test('migration upgrades a version-one catalogue without reseeding or changing products', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-upgrade-'))
  const old = new Database(join(directory, 'pricedesk.sqlite'))
  old.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, pricePaise INTEGER NOT NULL CHECK(pricePaise >= 0)) STRICT;
    INSERT INTO products VALUES (1, 'EXISTING', 'Existing product', 123);
    PRAGMA user_version = 1;`)
  old.close()
  const db = openDatabase(directory)
  try {
    const repo = createQuoteRepository(db)
    const quote = repo.createQuote({
      customerName: 'Upgrade',
      discountPaise: 0,
      items: [{ productId: 1, quantity: 1 }]
    })
    assert.equal(quote.items[0].sku, 'EXISTING')
    assert.equal((db.prepare('SELECT count(*) AS n FROM products').get() as { n: number }).n, 1)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
