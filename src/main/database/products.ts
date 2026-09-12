import type Database from 'better-sqlite3'
import type { Product } from '../../preload/api'

export function createProductRepository(database: Database.Database): {
  getProducts: () => Product[]
} {
  const selectProducts = database.prepare<[], Product>(
    'SELECT id, sku, name, pricePaise FROM products ORDER BY id'
  )
  return { getProducts: () => selectProducts.all() }
}
