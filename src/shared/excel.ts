export interface ExcelExportResult {
  canceled: boolean
}

export interface ProductImportRow {
  rowNumber: number
  sku: string
  name: string
  priceINR: string
  errors: string[]
}

export interface ProductImportPreview {
  canceled: false
  token: string | null
  expiresAt: number | null
  rows: ProductImportRow[]
  errors: string[]
}

export type ProductImportResult = { canceled: true } | ProductImportPreview

export interface ImportedProduct {
  sku: string
  name: string
  pricePaise: number
}
