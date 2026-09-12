import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import {
  createProductTemplate,
  createQuoteWorkbook,
  validateProductWorkbook,
  parseProductWorkbook,
  MAX_IMPORT_BYTES
} from './workbooks'
import { createImportSession, IMPORT_TOKEN_TTL } from './import-session'
import { readImportFile, excelSavePath } from './files'
import { openDatabase } from '../database'
import { createProductRepository } from '../database/products'
import { createQuoteRepository } from '../database/quotes'
import type { Quote } from '../../preload/api'
import { createExcelService } from './index'
import type { BrowserWindow } from 'electron'

function workbook(rows: ExcelJS.CellValue[][]): ExcelJS.Workbook {
  const book = createProductTemplate()
  for (const row of rows) book.worksheets[0].addRow(row)
  return book
}

test('template headers and decimal prices round-trip through an actual xlsx', async () => {
  const book = workbook([
    [' SKU-1 ', ' First ', 19.99],
    ['SKU-2', 'Second', '0.10'],
    ['SKU-3', 'Free', 0]
  ])
  assert.deepEqual(
    [1, 2, 3].map((column) => book.worksheets[0].getRow(1).getCell(column).value),
    ['SKU', 'Name', 'PriceINR']
  )
  const result = await parseProductWorkbook(Buffer.from(await book.xlsx.writeBuffer()))
  assert.deepEqual(result.errors, [])
  assert.ok(result.rows.every((row) => !row.errors.length))
  assert.deepEqual(result.products, [
    { sku: 'SKU-1', name: 'First', pricePaise: 1999 },
    { sku: 'SKU-2', name: 'Second', pricePaise: 10 },
    { sku: 'SKU-3', name: 'Free', pricePaise: 0 }
  ])
})

test('headers can be reordered; missing, duplicate, formula and extra headers are rejected', () => {
  const book = workbook([['1.25', 'SKU', 'Name']])
  book.worksheets[0].getRow(1).values = ['PriceINR', 'SKU', 'Name']
  assert.equal(validateProductWorkbook(book).products[0].pricePaise, 125)
  for (const header of [
    ['SKU', 'Name'],
    ['SKU', 'SKU', 'PriceINR'],
    ['SKU', 'Name', { formula: '1', result: 'PriceINR' }],
    ['SKU', 'Name', 'PriceINR', 'Other']
  ] as ExcelJS.CellValue[][]) {
    book.worksheets[0].getRow(1).values = header
    const result = validateProductWorkbook(book)
    assert.ok(result.errors.length)
    assert.deepEqual(result.products, [])
  }
})

test('invalid money, empty fields, unsupported cell types and duplicate SKUs identify rows', () => {
  for (const price of [
    -1,
    0.001,
    '1.234',
    '1e2',
    'NaN',
    'Infinity',
    true,
    null,
    new Date(),
    '90071992547409.92'
  ]) {
    const result = validateProductWorkbook(
      workbook([
        ['SKU', 'Name', price],
        ['VALID', 'Valid', 1]
      ])
    )
    assert.equal(result.rows[0].rowNumber, 2)
    assert.ok(result.rows[0].errors.some((error) => error.startsWith('PriceINR')))
    assert.deepEqual(result.products, [])
  }
  assert.equal(
    validateProductWorkbook(workbook([['MAX', 'Maximum', '90071992547409.91']])).products[0]
      .pricePaise,
    Number.MAX_SAFE_INTEGER
  )
  const result = validateProductWorkbook(
    workbook([
      ['', 'Name', 1],
      ['SKU', ' ', 1],
      ['DUP', 'First', 1],
      [' DUP ', 'Second', 2],
      [123, 'Numeric SKU', 1]
    ])
  )
  assert.ok(result.rows.every((row) => row.errors.length))
  assert.match(result.rows[2].errors.join(' '), /row 5/)
  assert.match(result.rows[3].errors.join(' '), /row 4/)
  assert.deepEqual(result.products, [])
})

test('formula cells including shared formulas and formulas in extra columns are rejected', async () => {
  for (const column of [1, 2, 3, 4]) {
    const book = workbook([['SKU', 'Name', 1]])
    book.worksheets[0].getRow(2).getCell(column).value = { formula: '1+1', result: 2 }
    const result = await parseProductWorkbook(Buffer.from(await book.xlsx.writeBuffer()))
    assert.ok(result.rows[0].errors.some((error) => error.includes('formulas')))
    assert.deepEqual(result.products, [])
  }
  const shared = workbook([
    ['SKU1', 'First', { formula: '1+1', result: 2 }],
    ['SKU2', 'Second', { sharedFormula: 'C2', result: 2 }]
  ])
  const result = await parseProductWorkbook(Buffer.from(await shared.xlsx.writeBuffer()))
  assert.ok(result.rows.every((row) => row.errors.some((error) => error.includes('formulas'))))
})

test('empty workbooks, multiple sheets and excess product rows cannot be imported', () => {
  assert.ok(validateProductWorkbook(new ExcelJS.Workbook()).errors.length)
  assert.ok(validateProductWorkbook(createProductTemplate()).errors.length)
  const book = workbook(Array.from({ length: 1000 }, (_, i) => [`SKU-${i}`, 'Name', 1]))
  assert.equal(validateProductWorkbook(book).products.length, 1000)
  book.worksheets[0].addRow(['TOO-MANY', 'Name', 1])
  const result = validateProductWorkbook(book)
  assert.equal(result.rows.length, 1000)
  assert.match(result.errors.join(' '), /1,000/)
  assert.deepEqual(result.products, [])
  book.addWorksheet('Another')
  assert.match(validateProductWorkbook(book).errors.join(' '), /one worksheet/)
})

test('blank rows preserve Excel row numbers and merged product cells are rejected', () => {
  const book = createProductTemplate()
  book.worksheets[0].getRow(5).values = ['SKU', 'Name', 1]
  const result = validateProductWorkbook(book)
  assert.equal(result.rows[0].rowNumber, 5)
  assert.equal(result.products.length, 1)
  book.worksheets[0].mergeCells('A5:B5')
  assert.ok(validateProductWorkbook(book).rows[0].errors.some((error) => error.includes('merged')))
})

test('file reading enforces extension, regular files and the 5 MB limit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-excel-files-'))
  try {
    const path = join(directory, 'products.xlsx')
    const bytes = Buffer.from(await workbook([['SKU', 'Name', 1]]).xlsx.writeBuffer())
    writeFileSync(path, bytes)
    assert.deepEqual(await readImportFile(path), bytes)
    await assert.rejects(readImportFile(join(directory, 'products.xls')), /xlsx/)
    writeFileSync(path, Buffer.alloc(MAX_IMPORT_BYTES + 1))
    await assert.rejects(readImportFile(path), /5 MB/)
    await assert.rejects(parseProductWorkbook(Buffer.alloc(MAX_IMPORT_BYTES + 1)), /5 MB/)
    await assert.rejects(parseProductWorkbook(Buffer.from('not an xlsx')), /valid, unencrypted/)
    assert.equal(excelSavePath('/tmp/quote'), '/tmp/quote.xlsx')
    assert.equal(excelSavePath('/tmp/quote.XLSX'), '/tmp/quote.XLSX')
    assert.throws(() => excelSavePath('/tmp/quote.csv'), /xlsx/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('preview tokens bind the exact dataset to an owner and reject reuse, expiration and replacement', () => {
  let now = 0
  const saved: unknown[] = []
  const session = createImportSession(
    (rows) => {
      saved.push(rows)
      return rows.length
    },
    () => now
  )
  const validated = validateProductWorkbook(workbook([['SKU', 'Name', 1]]))
  const preview = session.preview(1, validated)
  assert.ok(preview.token)
  validated.products[0].pricePaise = 99999
  preview.rows[0].name = 'Forged renderer name'
  assert.throws(() => session.confirm(2, preview.token), /no longer valid/)
  assert.throws(() => session.confirm(1, { token: preview.token, products: [] }), /no longer valid/)
  assert.deepEqual(session.confirm(1, preview.token), { importedCount: 1 })
  assert.deepEqual(saved, [[{ sku: 'SKU', name: 'Name', pricePaise: 100 }]])
  assert.throws(() => session.confirm(1, preview.token), /no longer valid/)
  const expired = session.preview(1, validateProductWorkbook(workbook([['SKU', 'Name', 1]])))
  now = IMPORT_TOKEN_TTL
  assert.throws(() => session.confirm(1, expired.token), /expired/)
  const old = session.preview(1, validateProductWorkbook(workbook([['SKU', 'Name', 1]])))
  session.preview(1, validateProductWorkbook(workbook([['OTHER', 'Name', 1]])))
  assert.throws(() => session.confirm(1, old.token), /no longer valid/)
  session.clear()
  assert.equal(session.preview(1, validateProductWorkbook(workbook([['SKU', '', 1]]))).token, null)
  assert.throws(() => session.confirm(1, null), /no longer valid/)
})

test('import preserves product IDs, saved quotes and outbox snapshots, and rolls back all writes on failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-excel-import-'))
  const db = openDatabase(directory)
  try {
    const products = createProductRepository(db)
    const quotes = createQuoteRepository(db)
    const quote = quotes.createQuote({
      customerName: 'Saved customer',
      discountPaise: 0,
      items: [{ productId: 1, quantity: 1 }]
    })
    const outbox = db.prepare('SELECT payload FROM quote_outbox').get()
    const session = createImportSession(products.importProducts)
    const preview = session.preview(
      1,
      validateProductWorkbook(
        workbook([
          ['PD-001', 'New name', 1.25],
          ['NEW', 'New product', 2]
        ])
      )
    )
    assert.deepEqual(session.confirm(1, preview.token), { importedCount: 2 })
    assert.equal(products.getProducts().find((row) => row.sku === 'PD-001')!.id, 1)
    assert.equal(products.getProducts().find((row) => row.sku === 'PD-001')!.pricePaise, 125)
    assert.equal(products.getProducts().find((row) => row.sku === 'NEW')!.pricePaise, 200)
    assert.deepEqual(quotes.getQuote(quote.id), quote)
    assert.deepEqual(db.prepare('SELECT payload FROM quote_outbox').get(), outbox)
    const before = products.getProducts()
    db.exec(`CREATE TRIGGER fail_product BEFORE INSERT ON products WHEN NEW.sku = 'FAIL'
      BEGIN SELECT RAISE(ABORT, 'Injected import failure'); END`)
    const failure = session.preview(
      1,
      validateProductWorkbook(
        workbook([
          ['PD-001', 'Should roll back', 9],
          ['FAIL', 'Failure', 3]
        ])
      )
    )
    assert.throws(() => session.confirm(1, failure.token), /Injected import failure/)
    assert.deepEqual(products.getProducts(), before)
    assert.throws(() => session.confirm(1, failure.token), /no longer valid/)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('quote workbook exports snapshot amounts as numbers and user text as plain strings', async () => {
  const quote: Quote = {
    id: 7,
    globalId: 'quote-uuid',
    customerName: '=HYPERLINK("https://example.com")',
    createdAt: '2026-09-12T00:00:00.000Z',
    subtotalPaise: 24690,
    discountPaise: 90,
    totalPaise: 24600,
    items: [
      {
        productId: 1,
        sku: '+SUM(1,2)',
        name: '@example',
        unitPricePaise: 12345,
        quantity: 2,
        lineTotalPaise: 24690
      }
    ]
  }
  const book = createQuoteWorkbook(quote)
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(await book.xlsx.writeBuffer())
  const sheet = loaded.worksheets[0]
  assert.equal(sheet.getCell('B2').value, quote.customerName)
  assert.equal(sheet.getCell('B3').value, 7)
  assert.equal(sheet.getCell('B4').value, quote.globalId)
  assert.equal(sheet.getCell('B5').value, quote.createdAt)
  assert.equal(sheet.getCell('A8').value, '+SUM(1,2)')
  assert.equal(sheet.getCell('B8').value, '@example')
  assert.equal(sheet.getCell('C8').value, 2)
  assert.equal(sheet.getCell('D8').value, 123.45)
  assert.equal(sheet.getCell('E8').value, 246.9)
  assert.equal(sheet.getCell('E11').value, 0.9)
  assert.equal(sheet.getCell('E12').value, 246)
  assert.match(sheet.getCell('E12').numFmt, /0.00/)
  sheet.eachRow((row) =>
    row.eachCell((cell) => assert.notEqual(cell.type, ExcelJS.ValueType.Formula))
  )
})

test('main handles cancellation, validates IDs before dialogs, and commits the preview despite file edits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-excel-service-'))
  const db = openDatabase(directory)
  try {
    const products = createProductRepository(db)
    const quotes = createQuoteRepository(db)
    const quote = quotes.createQuote({
      customerName: 'Customer',
      discountPaise: 0,
      items: [{ productId: 1, quantity: 1 }]
    })
    let canceled = true
    let saveCalls = 0
    const path = join(directory, 'products.xlsx')
    const dialogs: Parameters<typeof createExcelService>[3] = {
      showSaveDialog: async () => {
        saveCalls++
        return { canceled, filePath: path }
      },
      showOpenDialog: async () => ({ canceled, filePaths: canceled ? [] : [path] }),
      showMessageBox: async () => ({ response: 0, checkboxChecked: false })
    }
    const window = { isDestroyed: () => false } as BrowserWindow
    const service = createExcelService(() => window, products, quotes, dialogs)
    await assert.rejects(service.exportQuoteExcel('1'), /safe integer/)
    await assert.rejects(service.exportQuoteExcel(-1), /safe integer/)
    await assert.rejects(service.exportQuoteExcel(999), /not found/)
    assert.equal(saveCalls, 0)
    assert.deepEqual(await service.exportQuoteExcel(quote.id), { canceled: true })
    assert.deepEqual(await service.exportProductTemplate(), { canceled: true })
    assert.deepEqual(await service.previewProductImport(1), { canceled: true })
    canceled = false
    writeFileSync(
      path,
      Buffer.from(await workbook([['PD-001', 'Reviewed name', '12.34']]).xlsx.writeBuffer())
    )
    const preview = await service.previewProductImport(1)
    assert.equal(preview.canceled, false)
    if (preview.canceled) throw new Error('Expected preview')
    writeFileSync(path, 'file changed after preview')
    assert.deepEqual(service.confirmProductImport(1, preview.token), { importedCount: 1 })
    assert.equal(products.getProducts()[0].name, 'Reviewed name')
    assert.equal(products.getProducts()[0].pricePaise, 1234)
    assert.deepEqual(await service.exportQuoteExcel(quote.id), { canceled: false })
    const exported = new ExcelJS.Workbook()
    await exported.xlsx.readFile(path)
    assert.equal(exported.worksheets[0].getCell('D8').value, 99)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
