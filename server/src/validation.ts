import { calculateTotals, requireInteger } from '../../src/shared/money'
import { isUuid, type UploadPayload } from '../../src/shared/sync'

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object')
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Unexpected fields')
  return value as Record<string, unknown>
}

function string(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Invalid text')
}

export function validateUpload(input: unknown): UploadPayload {
  const value = record(input, ['operationId', 'quote'])
  if (!isUuid(value.operationId)) throw new Error('Invalid operation UUID')
  const quote = record(value.quote, [
    'globalId',
    'customerName',
    'createdAt',
    'discountPaise',
    'items'
  ])
  if (!isUuid(quote.globalId)) throw new Error('Invalid quote UUID')
  string(quote.customerName, 200)
  string(quote.createdAt, 24)
  if (
    !Number.isFinite(Date.parse(quote.createdAt)) ||
    new Date(quote.createdAt).toISOString() !== quote.createdAt
  ) {
    throw new Error('Invalid creation timestamp')
  }
  requireInteger(quote.discountPaise)
  if (!Array.isArray(quote.items) || quote.items.length < 1 || quote.items.length > 100)
    throw new Error('Expected 1–100 items')
  const seen = new Set<number>()
  const items = quote.items.map((item: unknown) => {
    const row = record(item, ['productId', 'sku', 'name', 'unitPricePaise', 'quantity'])
    requireInteger(row.productId, 1)
    requireInteger(row.unitPricePaise)
    requireInteger(row.quantity, 1)
    string(row.sku, 200)
    string(row.name, 1000)
    if (seen.has(row.productId)) throw new Error('Duplicate product')
    seen.add(row.productId)
    return {
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      unitPricePaise: row.unitPricePaise,
      quantity: row.quantity
    }
  })
  calculateTotals(items, quote.discountPaise)
  return {
    operationId: value.operationId,
    quote: {
      globalId: quote.globalId,
      customerName: quote.customerName,
      createdAt: quote.createdAt,
      discountPaise: quote.discountPaise,
      items
    }
  }
}
