import { contextBridge, ipcRenderer } from 'electron'
import type { AppAPI, Product, Quote, QuoteSummary, RuntimeInfo } from './api'
import type { SyncStatus } from '../shared/sync'

function validateSyncStatus(value: unknown): SyncStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid sync status')
  const status = value as SyncStatus
  if (
    typeof status.running !== 'boolean' ||
    ![status.pendingCount, status.failedCount, status.syncedCount].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    ) ||
    !Array.isArray(status.failures) ||
    !status.failures.every(
      (row) =>
        row &&
        Number.isSafeInteger(row.quoteId) &&
        row.quoteId > 0 &&
        typeof row.operationId === 'string' &&
        ['pending', 'failed'].includes(row.status) &&
        Number.isSafeInteger(row.attemptCount) &&
        row.attemptCount >= 0 &&
        (row.nextRetryAt === null || Number.isSafeInteger(row.nextRetryAt)) &&
        typeof row.lastError === 'string'
    )
  ) {
    throw new Error('Invalid sync status')
  }
  return status
}

function isSummary(value: unknown): value is QuoteSummary {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'number' &&
    Number.isSafeInteger(row.id) &&
    row.id > 0 &&
    typeof row.globalId === 'string' &&
    typeof row.customerName === 'string' &&
    typeof row.createdAt === 'string' &&
    ['subtotalPaise', 'discountPaise', 'totalPaise'].every(
      (key) => typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && row[key] >= 0
    )
  )
}

function isQuote(value: unknown): value is Quote {
  if (!isSummary(value) || !('items' in value) || !Array.isArray(value.items)) return false
  return value.items.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false
    const row = item as Record<string, unknown>
    return (
      typeof row.sku === 'string' &&
      typeof row.name === 'string' &&
      ['productId', 'quantity', 'unitPricePaise', 'lineTotalPaise'].every(
        (key) =>
          typeof row[key] === 'number' &&
          Number.isSafeInteger(row[key]) &&
          row[key] >= (key === 'productId' || key === 'quantity' ? 1 : 0)
      )
    )
  })
}

function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) return false
  const product = value as Record<string, unknown>
  return (
    Number.isSafeInteger(product.id) &&
    typeof product.sku === 'string' &&
    typeof product.name === 'string' &&
    typeof product.pricePaise === 'number' &&
    Number.isSafeInteger(product.pricePaise) &&
    product.pricePaise >= 0
  )
}

const api: AppAPI = {
  syncNow: async () => validateSyncStatus(await ipcRenderer.invoke('sync:now')),
  getSyncStatus: async () => validateSyncStatus(await ipcRenderer.invoke('sync:status')),
  getAppVersion: async () => {
    const version: unknown = await ipcRenderer.invoke('app:get-version')
    if (typeof version !== 'string') throw new Error('Invalid app version response')
    return version
  },
  getProducts: async () => {
    const products: unknown = await ipcRenderer.invoke('products:get-all')
    if (!Array.isArray(products) || !products.every(isProduct)) {
      throw new Error('Invalid products response')
    }
    return products
  },
  createQuote: async (input) => {
    const quote: unknown = await ipcRenderer.invoke('quotes:create', input)
    if (!isQuote(quote)) throw new Error('Invalid quote response')
    return quote
  },
  listQuotes: async () => {
    const quotes: unknown = await ipcRenderer.invoke('quotes:list')
    if (!Array.isArray(quotes) || !quotes.every(isSummary))
      throw new Error('Invalid quotes response')
    return quotes
  },
  getQuote: async (id) => {
    const quote: unknown = await ipcRenderer.invoke('quotes:get', id)
    if (quote !== null && !isQuote(quote)) throw new Error('Invalid quote response')
    return quote
  }
}

// Keep the starter's version display without exposing generic Electron APIs.
const runtimeInfo: RuntimeInfo = {
  process: {
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('electron', runtimeInfo)
