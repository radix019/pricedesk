# PriceDesk

PriceDesk is an offline Electron application: the React/TypeScript renderer displays products and quotations, while the main process manages windows, validates requests, and accesses SQLite.
A sandboxed, context-isolated preload exposes a narrow typed `window.api` bridge; IPC connects the UI to main-process handlers.

## Main-process API

These functions are available to React through `window.api`. Their handlers live in `src/main/ipc.ts` and are registered by `src/main/index.ts`.

| Function                                                                  | IPC channel                     | Purpose                                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAppVersion(): Promise<string>`                                        | `app:get-version`               | Returns the application's version.                                                                                                                                     |
| `getProducts(): Promise<Product[]>`                                       | `products:get-all`              | Returns catalogue products in ID order, including SKU, name, and price in paise.                                                                                       |
| `createQuote(input: CreateQuoteInput): Promise<Quote>`                    | `quotes:create`                 | Validates input, reads current catalogue prices, calculates totals, and atomically saves the quote, item snapshots, and immutable upload payload.                      |
| `listQuotes(): Promise<QuoteSummary[]>`                                   | `quotes:list`                   | Returns saved quote summaries, newest local ID first.                                                                                                                  |
| `getQuote(id: number): Promise<Quote \| null>`                            | `quotes:get`                    | Returns a saved quote with item snapshots, or `null` when absent. The ID must be a positive safe integer.                                                              |
| `syncNow(): Promise<SyncStatus>`                                          | `sync:now`                      | Processes currently due pending uploads and returns status after the run. Concurrent calls share the active run; this does not bypass backoff or reset failed uploads. |
| `getSyncStatus(): Promise<SyncStatus>`                                    | `sync:status`                   | Reads local outbox counts and failure details without making an HTTP request.                                                                                          |
| `exportQuoteExcel(quoteId: number): Promise<ExcelExportResult>`           | `excel:export-quote`            | Validates the positive safe-integer ID, loads the saved quote, opens a native Save dialog, and exports an `.xlsx` workbook. Rejects if the quote is absent.            |
| `exportProductTemplate(): Promise<ExcelExportResult>`                     | `excel:export-product-template` | Opens a native Save dialog for an Excel product template with `SKU`, `Name`, and `PriceINR` headers.                                                                   |
| `previewProductImport(): Promise<ProductImportResult>`                    | `excel:preview-products`        | Opens a native Open dialog, validates the chosen workbook, and returns preview rows and errors. A valid dataset is retained in main behind an expiring token.          |
| `confirmProductImport(token: string): Promise<{ importedCount: number }>` | `excel:confirm-products`        | Consumes the preview token and commits its exact dataset in one transaction. Updates products by SKU and inserts new products while preserving existing IDs.           |

Every handler validates the sending window, main frame, and renderer URL. The renderer cannot supply filesystem paths, arbitrary IPC channels, upload URLs, or replacement import rows. Operational failures reject the returned Promise; native dialog cancellation is a normal result. Preload validates response shapes before returning them to React.

### Quote and product contracts

Contracts are defined in `src/preload/api.d.ts`:

- `Product`: `id`, `sku`, `name`, `pricePaise`.
- `CreateQuoteInput`: `customerName`, `items: { productId, quantity }[]`, `discountPaise`. Customer names are trimmed and limited to 1–200 characters; a quote requires 1–100 distinct products. Product IDs and quantities must be positive safe integers. Unknown fields, missing products, unsafe monetary calculations, and discounts above the subtotal are rejected. The renderer cannot supply authoritative prices or totals.
- `QuoteSummary`: local numeric `id`, UUID `globalId`, `customerName`, ISO `createdAt`, `subtotalPaise`, `discountPaise`, `totalPaise`.
- `Quote`: all summary fields plus `items: QuoteItem[]`. Each saved item contains `productId`, `sku`, `name`, `unitPricePaise`, `quantity`, and `lineTotalPaise`.

A successful local quote save does not depend on API availability. Later catalogue imports do not change historical quote items or their queued upload payloads.

### Sync contract and lifecycle

`SyncStatus`, defined in `src/shared/sync.ts`, contains:

```ts
{
  running: boolean
  pendingCount: number
  syncedCount: number
  failedCount: number
  failures: {
    quoteId: number // Local numeric quote ID
    operationId: string
    status: 'pending' | 'failed'
    attemptCount: number
    nextRetryAt: number | null // Unix time in milliseconds
    lastError: string
  }
  ;[]
}
```

`pendingCount` includes uploads awaiting their first attempt or a retry. `failedCount` counts uploads requiring review. `failures` includes both retryable pending errors and permanent failures, ordered by descending local quote ID; it is not limited to the `failedCount` rows.

`createSyncService()` in `src/main/sync/index.ts` provides the internal `start()` and `stop()` lifecycle methods as well as the two public sync operations. Main starts a queue check at startup and every second. A single Electron instance owns the outbox, and only one sync run executes at a time. Shutdown cancels active requests and waits for sync to finish before closing SQLite.

Axios sends requests to loopback with a 10-second timeout and no redirects. Network failures and HTTP 429/500/502/503/504 retain pending status and retry with exponential delays of 1, 2, 4, … seconds, capped at five minutes. Attempts and retry timestamps are recorded before network I/O and survive restart. Other HTTP errors and invalid acknowledgements remain failed for review. The worker uses its own persisted backoff; it does not currently consume the server's `Retry-After` header.

Only newly created quotes are queued. Migration assigns UUIDs to older quotes without uploading them. An upload becomes synced only after main validates the acknowledgement's operation ID, global quote ID, payload hash, draft status, timestamp, and recalculated totals. There is no failure-editing or price-approval API.

### Excel result and token contracts

The types live in `src/shared/excel.ts`:

```ts
interface ExcelExportResult {
  canceled: boolean
}

interface ProductImportRow {
  rowNumber: number // Original Excel row number
  sku: string
  name: string
  priceINR: string // Display value; validated paise remain in main
  errors: string[]
}

interface ProductImportPreview {
  canceled: false
  token: string | null
  expiresAt: number | null // Unix time in milliseconds
  rows: ProductImportRow[]
  errors: string[] // Header/workbook-level errors
}

type ProductImportResult = { canceled: true } | ProductImportPreview
```

Exports return `{ canceled: false }` after writing, or `{ canceled: true }` on cancellation, without exposing a path. Invalid workbook contents return preview errors with `token: null` and `expiresAt: null`; unreadable files, invalid file types, and oversized files reject the Promise. Formula and row-validation errors appear on their affected rows.

Import tokens are bound to the originating renderer's `webContents.id`, expire after five minutes, and are single-use, including when the commit fails. Starting another import selection invalidates the previous token even if that selection is canceled. Restarting Electron also loses pending previews. Confirmation takes only the token and never rereads the file; expired, replaced, reused, or wrong-owner tokens require selecting the workbook again. Dialog/parsing/export operations are serialized in main, and confirmation is rejected while one is running. See the offline Excel section below for workbook rules and the user workflow.

## Express development API

The independent `server/` package provides a localhost HTTP API for one-way quote uploads. It uses Express and Node's `node:sqlite`, with its own dependencies and persistent database; it does not load Electron's native `better-sqlite3` module. The default address is `http://127.0.0.1:4317`. Set `PRICEDESK_API_PORT` in both the API and Electron environments to change the port. The host remains `127.0.0.1`; this development API has no authentication.

`server/src/index.ts` opens the database and starts the server. `createApi(db)` in `server/src/app.ts` creates the Express application with these routes:

| Endpoint       | Request                                                                                           | Success response                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /health`  | No body.                                                                                          | HTTP 200 with `{ "status": "ok" }` after a database probe. This checks connectivity, not availability of a write lock. |
| `POST /quotes` | `Content-Type: application/json`; an `UploadPayload` as below. JSON bodies are limited to 512 KB. | HTTP 201 for a new upload; HTTP 200 with the original acknowledgement for an identical duplicate.                      |

### Upload request

`UploadPayload` is defined in `src/shared/sync.ts`. For example:

```json
{
  "operationId": "c1fde78e-5959-4ef6-9823-5b7339bcb94b",
  "quote": {
    "globalId": "8c6cbd94-ef38-48f3-a1c4-d5c3ef890c96",
    "customerName": "Example customer",
    "createdAt": "2026-09-12T00:00:00.000Z",
    "discountPaise": 100,
    "items": [
      { "productId": 1, "sku": "PD-001", "name": "Notebook", "unitPricePaise": 9900, "quantity": 2 }
    ]
  }
}
```

`validateUpload(input)` in `server/src/validation.ts` rejects unknown fields, invalid IDs, blank or overlong text, invalid timestamps, duplicate product IDs, and invalid money/quantities. Both UUIDs must be lowercase UUID v4 strings. Customer names, SKUs, and product names are limited to 200, 200, and 1,000 characters respectively. Creation time must match the UTC ISO format emitted by `Date.toISOString()`. Items must contain 1–100 rows; product IDs and quantities are positive safe integers, and prices and discount are nonnegative safe integers in paise. Calculated totals must remain safe integers, and discount cannot exceed subtotal.

The server recalculates line totals, subtotal, and total. Uploaded unit prices are accepted as **draft snapshots**, never approved prices; there is no server-side catalogue-price lookup or price approval endpoint.

### Acknowledgement and idempotency

`QuoteAcknowledgement` contains:

```ts
{
  operationId: string
  quoteId: string // Global UUID, not Electron's numeric ID
  payloadHash: string
  status: 'draft'
  receivedAt: string // UTC ISO timestamp
  subtotalPaise: number
  totalPaise: number
}
```

The server commits the quote and receipt atomically. Receipts are keyed by `operationId`. Identical content under that UUID returns the stored acknowledgement, including its original timestamp, even after restart. `canonicalJson()` sorts object keys recursively before comparison and SHA-256 hashing, so key order is ignored while array order and supplied values remain significant. Reusing the operation UUID with changed content, or uploading the same quote UUID under another operation, returns a conflict. This makes redelivery safe when a response is lost after commit.

### HTTP errors

Error responses use `{ "error": "message" }`:

| Status | Meaning                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed JSON.                                                                                                  |
| 409    | Operation UUID reused with different content, or quote UUID already uploaded under another operation.            |
| 413    | JSON body exceeds the 512 KB limit.                                                                              |
| 415    | `POST /quotes` does not use `application/json`.                                                                  |
| 422    | Invalid upload fields, UUIDs, rows, or monetary values.                                                          |
| 500    | Unexpected server error; the response does not expose internal details.                                          |
| 503    | SQLite is busy/locked; includes `Retry-After: 5` and an actionable error. Electron retains the upload for retry. |

`openApiDatabase(path)` in `server/src/database.ts` creates the `quotes` and `receipts` tables on first startup and enables foreign keys with a five-second busy timeout. Already-current schemas do not require a startup write reservation. Migrations take a write transaction and recheck the version after acquiring it; newer schemas are rejected. `isDatabaseBusy(error)` recognizes SQLite BUSY/LOCKED codes, and `rollbackAfterError(db)` preserves the original error when a transaction never started or already rolled back.

The default API database is `server/data/pricedesk-api.sqlite` when launched with the provided scripts. `PRICEDESK_API_DB` overrides it; relative paths resolve from the API process's working directory (`server/` for those scripts). This is separate from Electron's `app.getPath('userData')/pricedesk.sqlite`. If a database editor holds a write lock, finish or revert its pending edits and close the database; a healthy `GET /health` response does not prove uploads can write.

## Key files

- `src/main/index.ts`: Starts Electron, opens the database after app readiness, registers IPC handlers, creates the window, starts sync, and stops sync before closing SQLite on quit.
- `src/main/database/`: Separates database initialization, versioned transactional migrations, and prepared-statement product/quote repositories. Data lives in `pricedesk.sqlite` under `app.getPath('userData')`, with foreign keys enabled.
- `src/main/sync/`: Owns the durable upload worker and Axios transport. `src/shared/sync.ts` defines upload, acknowledgement, and status contracts.
- `src/main/excel/`: Implements workbook generation/validation, bounded file reads, native dialogs, and preview tokens. The product repository's internal `importProducts()` performs transactional SKU upserts; it is not exposed directly over IPC.
- `server/src/`: Contains Express routing, upload validation, and the separate API database lifecycle.
- `src/main/ipc.ts`: Checks the sending window, main frame, and URL before dispatching API calls.
- `src/preload/index.ts` and `api.d.ts`: Expose the named API methods and define their shared TypeScript contracts. The existing runtime-version footer receives version data separately through `window.electron`.
- `src/renderer/src/`: Contains the catalogue, MUI/Formik/Yup quote form, saved-quotes list, and detail view.
- `src/shared/money.ts`: Converts rupee input to integer paise and checks monetary calculations. All stored monetary values use paise; saved item snapshots preserve historical SKU, name, and unit price.

## Navigation and renderer state

`main.tsx` provides one stable QueryClient and a HashRouter, so packaged URLs such as `index.html#/quotes/1` work without a web server. `App.tsx` lazy-loads the `/products`, `/quotes`, `/quotes/new`, `/quotes/:id`, and not-found pages inside a shared MUI navigation layout with a Suspense loading state.

- `src/renderer/src/queries/ipc.ts`: Typed hooks call the existing preload API using `['products']`, `['quotes']`, and `['quotes', id]` keys. The quote-creation mutation caches the saved detail and invalidates the quotes list before navigating to the saved quote.
- Local IPC queries and mutations use `networkMode: 'always'` and no automatic retries, including Excel and sync controls. The main-process Axios worker owns HTTP retries independently.
- `SyncPanel.tsx` polls `getSyncStatus()` every second under `['sync-status']` and offers **Sync Now**. `ProductExcelActions.tsx` holds the preview in component state and invalidates `['products']` after a successful confirmation; `QuoteExcelExport.tsx` handles export results and cancellation.
- `src/renderer/src/stores/sidebar.ts`: Zustand holds only sidebar visibility and its actions. Form drafts stay in Formik, and database records stay in the Query cache.

To check offline navigation, build and open PriceDesk, set DevTools Network to **Offline**, navigate between products and quotes, and save a new quote. Confirm its detail opens, the saved list includes it, and reloading its hash URL still works.

## Offline Excel import and export

On a saved quote's detail page, **Export Excel** opens a native Save dialog and
exports the saved customer, local/global quote IDs, UTC date, item snapshots,
quantities, numeric INR prices, subtotal, discount and total. User text is stored
as plain Excel strings, including text beginning with `=`, `+`, `-` or `@`.

On **Products**, choose **Export Product Template** for a workbook with the headers
`SKU`, `Name`, `PriceINR`. Fill in one worksheet, then choose **Import Products**.
The file must be `.xlsx`, at most 5 MB, and contain 1–1,000 nonempty product rows.
Headers go in row 1 and may be reordered. SKU/name are trimmed, nonempty text
(up to 200/1,000 characters); SKU matching is case-sensitive, like the catalogue.
Prices may be numeric cells or decimal text, must be nonnegative with no more than
two decimal places, and must convert to safe integer paise. Formulas, merged cells,
extra columns with data, and duplicate SKUs are rejected. Empty rows are ignored.

The preview lists Excel row numbers and validation errors. Correct invalid files
and select them again; no partial import is allowed. A valid preview expires after
five minutes. **Confirm Import** commits the exact rows retained in Electron main
in one transaction, updating matching SKUs and inserting new ones. Changing the
file after preview does not change the confirmed data. Existing product IDs,
historical quote snapshots and queued quote uploads are preserved. The product
catalogue refreshes after import. Canceling a file dialog or preview changes nothing.

All workbook parsing, file dialogs, file access, and validation run locally in
Electron main through narrow typed IPC methods. These operations work with the API
offline. `pnpm test` includes Excel validation, export round trips, import rollback,
token expiry/reuse, cancellation, and snapshot-preservation checks.

## Development checks

Run Electron and the optional sync API in separate terminals:

```bash
pnpm install
pnpm api:install
pnpm api:dev  # API terminal
pnpm dev      # Electron terminal
```

Use `pnpm api:build` then `pnpm api:start` to run the compiled API. Local quote saves and Excel operations work without the API running.

```bash
pnpm typecheck
pnpm api:typecheck
pnpm lint
pnpm test
pnpm api:test
```

The Electron tests use Electron's Node runtime for native SQLite and cover money, local transactions, migrations, sync recovery, and Excel import/export. API tests use ordinary Node with temporary databases and localhost listeners, covering duplicate delivery, rollback, validation, startup locks, and upload recovery. Native dialog behavior is tested using stubs.
