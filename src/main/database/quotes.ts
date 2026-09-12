import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { canonicalJson, type UploadPayload } from '../../shared/sync'
import type { CreateQuoteInput, Product, Quote, QuoteItem, QuoteSummary } from '../../preload/api'
import { calculateTotals, requireInteger } from '../../shared/money'

function validateInput(input: unknown): CreateQuoteInput {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid quote')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => !['customerName', 'items', 'discountPaise'].includes(key))) {
    throw new Error('Unexpected quote fields')
  }
  if (
    typeof value.customerName !== 'string' ||
    !value.customerName.trim() ||
    value.customerName.trim().length > 200
  )
    throw new Error('Customer name must contain 1–200 characters')
  requireInteger(value.discountPaise)
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > 100) {
    throw new Error('Add between 1 and 100 products')
  }
  const seen = new Set<number>()
  const items = value.items.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid product row')
    const row = item as Record<string, unknown>
    if (Object.keys(row).some((key) => !['productId', 'quantity'].includes(key))) {
      throw new Error('Unexpected product fields')
    }
    requireInteger(row.productId, 1)
    requireInteger(row.quantity, 1)
    if (seen.has(row.productId)) throw new Error('Duplicate products are not allowed')
    seen.add(row.productId)
    return { productId: row.productId, quantity: row.quantity }
  })
  return { customerName: value.customerName.trim(), discountPaise: value.discountPaise, items }
}

export function createQuoteRepository(database: Database.Database): {
  createQuote: (input: unknown) => Quote
  listQuotes: () => QuoteSummary[]
  getQuote: (id: unknown) => Quote | null
} {
  const product = database.prepare<[number], Product>('SELECT * FROM products WHERE id = ?')
  const insertQuote = database.prepare(`INSERT INTO quotes
    (globalId, customerName, createdAt, subtotalPaise, discountPaise, totalPaise)
    VALUES (@globalId, @customerName, @createdAt, @subtotalPaise, @discountPaise, @totalPaise)`)
  const enqueue =
    database.prepare(`INSERT INTO quote_outbox (operationId, quoteId, payload, nextRetryAt)
    VALUES (?, ?, ?, 0)`)
  const insertItem = database.prepare(`INSERT INTO quote_items
    (quoteId, productId, sku, name, unitPricePaise, quantity, lineTotalPaise)
    VALUES (@quoteId, @productId, @sku, @name, @unitPricePaise, @quantity, @lineTotalPaise)`)
  const summaries = database.prepare<[], QuoteSummary>('SELECT * FROM quotes ORDER BY id DESC')
  const summary = database.prepare<[number], QuoteSummary>('SELECT * FROM quotes WHERE id = ?')
  const items = database.prepare<[number], QuoteItem>(`SELECT productId, sku, name,
    unitPricePaise, quantity, lineTotalPaise FROM quote_items WHERE quoteId = ? ORDER BY productId`)

  const save = database.transaction((input: CreateQuoteInput): Quote => {
    const snapshots = input.items.map(({ productId, quantity }) => {
      const current = product.get(productId)
      if (!current) throw new Error(`Product ${productId} no longer exists`)
      return {
        productId,
        quantity,
        sku: current.sku,
        name: current.name,
        unitPricePaise: current.pricePaise
      }
    })
    const totals = calculateTotals(snapshots, input.discountPaise)
    const header = {
      globalId: randomUUID(),
      customerName: input.customerName,
      createdAt: new Date().toISOString(),
      subtotalPaise: totals.subtotalPaise,
      discountPaise: input.discountPaise,
      totalPaise: totals.totalPaise
    }
    const id = Number(insertQuote.run(header).lastInsertRowid)
    requireInteger(id, 1)
    const savedItems = snapshots.map((item, index) => {
      const snapshot = { ...item, lineTotalPaise: totals.lineTotals[index] }
      insertItem.run({ quoteId: id, ...snapshot })
      return snapshot
    })
    const payload: UploadPayload = {
      operationId: randomUUID(),
      quote: {
        globalId: header.globalId,
        customerName: header.customerName,
        createdAt: header.createdAt,
        discountPaise: header.discountPaise,
        items: snapshots
      }
    }
    enqueue.run(payload.operationId, id, canonicalJson(payload))
    return { id, ...header, items: savedItems }
  })
  return {
    createQuote: (input) => save.immediate(validateInput(input)),
    listQuotes: () => summaries.all(),
    getQuote: (id) => {
      requireInteger(id, 1)
      const quote = summary.get(id)
      return quote ? { ...quote, items: items.all(id) } : null
    }
  }
}
