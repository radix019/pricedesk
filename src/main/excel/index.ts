import { dialog, type BrowserWindow } from 'electron'
import type { createProductRepository } from '../database/products'
import type { createQuoteRepository } from '../database/quotes'
import type { ExcelExportResult, ProductImportResult } from '../../../server/shared/excel'
import { requireInteger } from '../../../server/shared/money'
import { createProductTemplate, createQuoteWorkbook, parseProductWorkbook } from './workbooks'
import { createImportSession } from './import-session'
import { excelSavePath, readImportFile } from './files'
import type ExcelJS from 'exceljs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

export function createExcelService(
  getWindow: () => BrowserWindow | null,
  products: ReturnType<typeof createProductRepository>,
  quotes: ReturnType<typeof createQuoteRepository>,
  dialogs: Pick<typeof dialog, 'showSaveDialog' | 'showOpenDialog' | 'showMessageBox'> = dialog
): {
  exportQuoteExcel: (id: unknown) => Promise<ExcelExportResult>
  exportProductTemplate: () => Promise<ExcelExportResult>
  previewProductImport: (owner: number) => Promise<ProductImportResult>
  confirmProductImport: (owner: number, token: unknown) => { importedCount: number }
} {
  const session = createImportSession(products.importProducts)
  let busy = false
  const filters = [{ name: 'Excel workbook', extensions: ['xlsx'] }]
  function window(): BrowserWindow {
    const current = getWindow()
    if (!current || current.isDestroyed()) throw new Error('The application window is unavailable.')
    return current
  }
  async function exclusively<T>(action: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('Another Excel operation is in progress.')
    busy = true
    try {
      return await action()
    } finally {
      busy = false
    }
  }
  async function save(workbook: ExcelJS.Workbook, defaultPath: string): Promise<ExcelExportResult> {
    const result = await dialogs.showSaveDialog(window(), {
      title: 'Export Excel',
      defaultPath,
      filters
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const path = excelSavePath(result.filePath)
    // When appending the extension, the native dialog has not checked this final filename.
    if (path !== result.filePath) {
      const exists = await stat(path).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw new Error('Could not access the export destination.')
        }
      )
      if (exists) {
        const overwrite = await dialogs.showMessageBox(window(), {
          type: 'question',
          buttons: ['Cancel', 'Replace'],
          defaultId: 0,
          cancelId: 0,
          message: `${basename(path)} already exists. Replace it?`
        })
        if (overwrite.response !== 1) return { canceled: true }
      }
    }
    try {
      await workbook.xlsx.writeFile(path)
    } catch {
      throw new Error(
        'Could not save the workbook. Check that the destination is writable and the file is not open in another application.'
      )
    }
    return { canceled: false }
  }
  return {
    exportQuoteExcel: (id) =>
      exclusively(async () => {
        requireInteger(id, 1)
        const quote = quotes.getQuote(id)
        if (!quote) throw new Error('Quote not found.')
        return save(createQuoteWorkbook(quote), `PriceDesk-quote-${quote.id}.xlsx`)
      }),
    exportProductTemplate: () =>
      exclusively(() => save(createProductTemplate(), 'PriceDesk-products-template.xlsx')),
    previewProductImport: (owner) =>
      exclusively(async () => {
        session.clear()
        const result = await dialogs.showOpenDialog(window(), {
          title: 'Import Products',
          filters,
          properties: ['openFile']
        })
        if (result.canceled || !result.filePaths.length) return { canceled: true }
        let data: Buffer
        try {
          data = await readImportFile(result.filePaths[0])
        } catch (error) {
          if (error instanceof Error && !('code' in error)) throw error
          throw new Error('Could not open the workbook. Check file permissions and try again.')
        }
        return session.preview(owner, await parseProductWorkbook(data))
      }),
    confirmProductImport: (owner, token) => {
      if (busy) throw new Error('Another Excel operation is in progress.')
      return session.confirm(owner, token)
    }
  }
}
