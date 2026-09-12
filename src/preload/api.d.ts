export interface Product {
  id: number
  sku: string
  name: string
  pricePaise: number
}

export interface AppAPI {
  exportQuoteExcel: (quoteId: number) => Promise<ExcelExportResult>
  exportProductTemplate: () => Promise<ExcelExportResult>
  previewProductImport: () => Promise<ProductImportResult>
  confirmProductImport: (token: string) => Promise<{ importedCount: number }>
  syncNow: () => Promise<SyncStatus>
  getSyncStatus: () => Promise<SyncStatus>
  getAppVersion: () => Promise<string>
  getProducts: () => Promise<Product[]>
  createQuote: (input: CreateQuoteInput) => Promise<Quote>
  listQuotes: () => Promise<QuoteSummary[]>
  getQuote: (id: number) => Promise<Quote | null>
}

export interface CreateQuoteInput {
  customerName: string
  items: { productId: number; quantity: number }[]
  discountPaise: number
}

export interface QuoteSummary {
  globalId: string
  id: number
  customerName: string
  createdAt: string
  subtotalPaise: number
  discountPaise: number
  totalPaise: number
}

export interface QuoteItem {
  productId: number
  sku: string
  name: string
  unitPricePaise: number
  quantity: number
  lineTotalPaise: number
}

export interface Quote extends QuoteSummary {
  items: QuoteItem[]
}

export interface RuntimeInfo {
  process: {
    versions: {
      electron: string
      chrome: string
      node: string
    }
  }
}
import type { SyncStatus } from '../shared/sync'
import type { ExcelExportResult, ProductImportResult } from '../shared/excel'
