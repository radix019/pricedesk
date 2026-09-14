import { randomUUID } from 'node:crypto'
import type { ImportedProduct, ProductImportPreview } from '../../../server/shared/excel'
import type { ValidatedImport } from './workbooks'

export const IMPORT_TOKEN_TTL = 5 * 60 * 1000

export function createImportSession(
  save: (products: readonly ImportedProduct[]) => number,
  now: () => number = Date.now
): {
  preview: (owner: number, validated: ValidatedImport) => ProductImportPreview
  confirm: (owner: number, token: unknown) => { importedCount: number }
  clear: () => void
} {
  let pending:
    | { owner: number; token: string; expiresAt: number; products: readonly ImportedProduct[] }
    | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  function clear(): void {
    clearTimeout(timer)
    pending = undefined
  }
  return {
    clear,
    preview: (owner, validated) => {
      clear()
      const valid =
        !validated.errors.length &&
        validated.rows.length > 0 &&
        validated.rows.every((row) => !row.errors.length) &&
        validated.products.length === validated.rows.length
      if (valid) {
        pending = {
          owner,
          token: randomUUID(),
          expiresAt: now() + IMPORT_TOKEN_TTL,
          products: Object.freeze(
            validated.products.map((product) => Object.freeze({ ...product }))
          )
        }
        timer = setTimeout(clear, IMPORT_TOKEN_TTL)
        timer.unref()
      }
      return {
        canceled: false,
        token: pending?.token ?? null,
        expiresAt: pending?.expiresAt ?? null,
        rows: validated.rows,
        errors: validated.errors
      }
    },
    confirm: (owner, token) => {
      if (
        !pending ||
        typeof token !== 'string' ||
        token !== pending.token ||
        owner !== pending.owner
      ) {
        throw new Error('Import preview is no longer valid. Select the file again.')
      }
      if (now() >= pending.expiresAt) {
        clear()
        throw new Error('Import preview expired. Select the file again.')
      }
      const products = pending.products
      clear() // A token can be consumed only once, including when saving fails.
      return { importedCount: save(products) }
    }
  }
}
