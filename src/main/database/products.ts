import type Database from 'better-sqlite3'
import type { Product } from '../../preload/api'
import type { ImportedProduct } from '../../../server/shared/excel'
import { requireInteger } from '../../../server/shared/money'

export function createProductRepository(database: Database.Database): {
  getProducts: () => Product[]
  importProducts: (products: readonly ImportedProduct[]) => number
} {
  const selectProducts = database.prepare<[], Product>(
    'SELECT id, sku, name, pricePaise FROM products ORDER BY id'
  )
  const upsert =
    database.prepare(`INSERT INTO products (sku, name, pricePaise) VALUES (@sku, @name, @pricePaise)
    ON CONFLICT(sku) DO UPDATE SET name = excluded.name, pricePaise = excluded.pricePaise`)
  const save = database.transaction((products: readonly ImportedProduct[]) => {
    if (!products.length || products.length > 1000) throw new Error('Expected 1–1,000 products')
    const seen = new Set<string>()
    for (const product of products) {
      if (
        typeof product.sku !== 'string' ||
        !product.sku.trim() ||
        product.sku.length > 200 ||
        typeof product.name !== 'string' ||
        !product.name.trim() ||
        product.name.length > 1000 ||
        seen.has(product.sku)
      ) {
        throw new Error('Invalid or duplicate product')
      }
      requireInteger(product.pricePaise)
      seen.add(product.sku)
      upsert.run(product)
    }
    return products.length
  })
  return {
    getProducts: () => selectProducts.all(),
    importProducts: (products) => save.immediate(products)
  }
}
