import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { extname } from 'node:path'
import { MAX_IMPORT_BYTES } from './workbooks'

export async function readImportFile(path: string): Promise<Buffer> {
  if (extname(path).toLowerCase() !== '.xlsx') throw new Error('Choose an .xlsx file.')
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Choose a regular .xlsx file.')
    if (info.size > MAX_IMPORT_BYTES) throw new Error('Excel files must be 5 MB or smaller.')
    // Bound the read even if the selected file grows after stat.
    const buffer = Buffer.alloc(MAX_IMPORT_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > MAX_IMPORT_BYTES) throw new Error('Excel files must be 5 MB or smaller.')
    return buffer.subarray(0, size)
  } finally {
    await file.close()
  }
}

export function excelSavePath(path: string): string {
  const extension = extname(path)
  if (!extension) return `${path}.xlsx`
  if (extension.toLowerCase() !== '.xlsx')
    throw new Error('Save the workbook with an .xlsx extension.')
  return path
}
