import { contextBridge, ipcRenderer } from 'electron'
import type { AppAPI, Product, Quote, QuoteSummary, RuntimeInfo } from './api'
import type { SyncStatus } from '../shared/sync'
import type { ExcelExportResult, ProductImportResult } from '../shared/excel'

async function invokeExcel(
  channel:
    | 'excel:export-quote'
    | 'excel:export-product-template'
    | 'excel:preview-products'
    | 'excel:confirm-products',
  ...args: unknown[]
): Promise<unknown> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Excel operation failed.'
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
  }
}

function validateExport(value: unknown): ExcelExportResult {
  if (
    !value ||
    typeof value !== 'object' ||
    !('canceled' in value) ||
    typeof value.canceled !== 'boolean'
  ) {
    throw new Error('Invalid Excel export response')
  }
  return { canceled: value.canceled }
}

function validateImport(value: unknown): ProductImportResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid import preview')
  const preview = value as ProductImportResult
  if (preview.canceled === true) return { canceled: true }
  if (
    preview.canceled !== false ||
    !(preview.token === null || typeof preview.token === 'string') ||
    !(preview.expiresAt === null || Number.isSafeInteger(preview.expiresAt)) ||
    !Array.isArray(preview.errors) ||
    !preview.errors.every((error) => typeof error === 'string') ||
    !Array.isArray(preview.rows) ||
    preview.rows.length > 1000 ||
    !preview.rows.every(
      (row) =>
        row &&
        Number.isSafeInteger(row.rowNumber) &&
        row.rowNumber > 1 &&
        typeof row.sku === 'string' &&
        typeof row.name === 'string' &&
        typeof row.priceINR === 'string' &&
        Array.isArray(row.errors) &&
        row.errors.every((error) => typeof error === 'string')
    )
  ) {
    throw new Error('Invalid import preview')
  }
  return preview
}

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
  exportQuoteExcel: async (id) => validateExport(await invokeExcel('excel:export-quote', id)),
  exportProductTemplate: async () =>
    validateExport(await invokeExcel('excel:export-product-template')),
  previewProductImport: async () => validateImport(await invokeExcel('excel:preview-products')),
  confirmProductImport: async (token) => {
    const result: unknown = await invokeExcel('excel:confirm-products', token)
    if (
      !result ||
      typeof result !== 'object' ||
      !('importedCount' in result) ||
      typeof result.importedCount !== 'number' ||
      !Number.isSafeInteger(result.importedCount) ||
      result.importedCount < 1 ||
      result.importedCount > 1000
    )
      throw new Error('Invalid import confirmation')
    return { importedCount: result.importedCount }
  },
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
