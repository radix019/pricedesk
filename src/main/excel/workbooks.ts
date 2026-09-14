import ExcelJS from 'exceljs'
import type { Quote } from '../../preload/api'
import type { ImportedProduct, ProductImportRow } from '../../../server/shared/excel'
import { rupeesToPaise } from '../../../server/shared/money'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_PRODUCT_ROWS = 1000
const headers = ['SKU', 'Name', 'PriceINR']
const currencyFormat = '"₹" #,##0.00'

export function createProductTemplate(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Products')
  sheet.columns = [
    { header: 'SKU', width: 24, style: { numFmt: '@' } },
    { header: 'Name', width: 44, style: { numFmt: '@' } },
    { header: 'PriceINR', width: 20, style: { numFmt: '0.00' } }
  ]
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  return workbook
}

export function createQuoteWorkbook(quote: Quote): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Quote')
  sheet.columns = [{ width: 24 }, { width: 44 }, { width: 14 }, { width: 20 }, { width: 22 }]
  sheet.addRow(['PriceDesk quote']).font = { bold: true, size: 16 }
  sheet.addRow(['Customer', quote.customerName])
  sheet.addRow(['Quote ID', quote.id])
  sheet.addRow(['Global quote ID', quote.globalId])
  sheet.addRow(['Date (UTC)', quote.createdAt])
  sheet.addRow([])
  sheet.addRow(['SKU', 'Name', 'Quantity', 'Unit price (INR)', 'Amount (INR)']).font = {
    bold: true
  }
  for (const item of quote.items) {
    // String values remain XLSX strings, even when starting with =, +, -, or @.
    const row = sheet.addRow([
      item.sku,
      item.name,
      item.quantity,
      item.unitPricePaise / 100,
      item.lineTotalPaise / 100
    ])
    row.getCell(4).numFmt = currencyFormat
    row.getCell(5).numFmt = currencyFormat
  }
  sheet.addRow([])
  for (const [label, amount] of [
    ['Subtotal', quote.subtotalPaise],
    ['Discount', quote.discountPaise],
    ['Total', quote.totalPaise]
  ] as const) {
    const row = sheet.addRow([null, null, null, label, amount / 100])
    row.getCell(5).numFmt = currencyFormat
    if (label === 'Total') row.font = { bold: true }
  }
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') cell.numFmt = '@'
    })
  )
  sheet.views = [{ state: 'frozen', ySplit: 7 }]
  return workbook
}

export interface ValidatedImport {
  rows: ProductImportRow[]
  errors: string[]
  products: ImportedProduct[]
}

function display(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value))
    return '[Formula]'
  return '[Unsupported cell value]'
}

export function validateProductWorkbook(workbook: ExcelJS.Workbook): ValidatedImport {
  const result: ValidatedImport = { rows: [], errors: [], products: [] }
  if (workbook.worksheets.length !== 1) {
    result.errors.push('Use one worksheet with SKU, Name and PriceINR headers in row 1.')
    return result
  }
  const sheet = workbook.worksheets[0]
  const columns = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, column) => {
    if (cell.isMerged)
      result.errors.push(`Row 1, column ${column}: merged headers are not supported.`)
    const header = typeof cell.value === 'string' ? cell.value.trim() : ''
    if (!headers.includes(header))
      result.errors.push(
        `Row 1, column ${column}: expected SKU, Name or PriceINR; formulas are not allowed.`
      )
    else if (columns.has(header)) result.errors.push(`Row 1: duplicate ${header} header.`)
    else columns.set(header, column)
  })
  for (const header of headers) {
    if (!columns.has(header)) result.errors.push(`Row 1: missing ${header} header.`)
  }
  if (result.errors.length) return result
  const seen = new Map<string, ProductImportRow>()
  let count = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    let hasContent = false
    row.eachCell((cell) => {
      if (typeof cell.value !== 'string' || cell.value.trim() !== '') hasContent = true
    })
    if (!hasContent) return
    count++
    if (count > MAX_PRODUCT_ROWS) return
    const sku = row.getCell(columns.get('SKU')!).value
    const name = row.getCell(columns.get('Name')!).value
    const price = row.getCell(columns.get('PriceINR')!).value
    const preview: ProductImportRow = {
      rowNumber,
      sku: display(sku).trim(),
      name: display(name).trim(),
      priceINR: display(price).trim(),
      errors: []
    }
    row.eachCell((cell, column) => {
      if (cell.type === ExcelJS.ValueType.Formula)
        preview.errors.push(`Column ${column}: formulas are not allowed.`)
      if (![...columns.values()].includes(column))
        preview.errors.push(`Column ${column}: unexpected data outside the template columns.`)
      if (cell.isMerged) preview.errors.push(`Column ${column}: merged cells are not supported.`)
    })
    if (typeof sku !== 'string' || !sku.trim() || sku.trim().length > 200)
      preview.errors.push('SKU must be text with 1–200 characters.')
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 1000)
      preview.errors.push('Name must be text with 1–1,000 characters.')
    if (typeof sku === 'string' && sku.trim()) {
      const previous = seen.get(sku.trim())
      if (previous) {
        preview.errors.push(`Duplicate SKU; also appears on row ${previous.rowNumber}.`)
        previous.errors.push(`Duplicate SKU; also appears on row ${rowNumber}.`)
      } else seen.set(sku.trim(), preview)
    }
    let pricePaise = 0
    try {
      if (typeof price !== 'string' && typeof price !== 'number')
        throw new Error('PriceINR must be a number or decimal text.')
      pricePaise = rupeesToPaise(String(price).trim())
    } catch {
      preview.errors.push(
        'PriceINR must be nonnegative with at most two decimal places and within the safe money range.'
      )
    }
    result.rows.push(preview)
    result.products.push({ sku: preview.sku, name: preview.name, pricePaise })
  })
  if (count > MAX_PRODUCT_ROWS) result.errors.push('Import is limited to 1,000 product rows.')
  if (!count) result.errors.push('Add at least one product row.')
  if (result.errors.length || result.rows.some((row) => row.errors.length)) result.products = []
  return result
}

export async function parseProductWorkbook(data: Buffer): Promise<ValidatedImport> {
  if (data.length > MAX_IMPORT_BYTES) throw new Error('Excel files must be 5 MB or smaller.')
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(data as unknown as ExcelJS.Buffer)
  } catch {
    throw new Error('Could not read this workbook. Choose a valid, unencrypted .xlsx file.')
  }
  return validateProductWorkbook(workbook)
}
