# pricedesk

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

## Backend connection

Electron connects to `http://13.204.88.45:4317` by default, including packaged builds.
The main process uploads queued quotes to `/quotes`; React continues to use the
preload/IPC API. Start the desktop app with `pnpm dev` to use the EC2 backend.

To override the backend, set `PRICEDESK_API_URL` in the environment before launching
Electron, for example:

```bash
PRICEDESK_API_URL=http://127.0.0.1:4317 pnpm dev
```

The URL must use HTTP or HTTPS and must not contain credentials, a query, or a
fragment. Restart Electron after changing it. This is a runtime environment
variable; the app does not automatically load it from a `.env` file.
`PRICEDESK_API_PORT` is now a server-only setting; desktop overrides use the full URL.

## Local quote sync development

Use Node.js 22.13+ (tested with 22.21). The Express API is an independent package in
`server/`, with its own `package-lock.json` and persistent SQLite database. It uses
[Node's built-in SQLite](https://nodejs.org/docs/latest-v22.x/api/sqlite.html), so it
does not load or rebuild Electron's `better-sqlite3`. Node 22 may print SQLite's
experimental-feature notice. The API and its data are excluded from Electron builds.

From the repository root:

```bash
pnpm install
pnpm api:install
pnpm api:dev             # terminal 1: http://127.0.0.1:4317
PRICEDESK_API_URL=http://127.0.0.1:4317 pnpm dev # terminal 2: Electron
curl http://127.0.0.1:4317/health
```

For a compiled API, run `pnpm api:build`, then `pnpm api:start`. The API defaults to
binding to `127.0.0.1`. To change the local port, set `PORT` for the server and use
the matching port in Electron's `PRICEDESK_API_URL`.
`PRICEDESK_API_DB` overrides the API database path; relative paths resolve from
`server/` when using these scripts. The default is `server/data/pricedesk-api.sqlite`.
The Electron database remains `pricedesk.sqlite` in Electron's `userData` directory.
Do not point the two applications at the same database.

### Behavior and contract

- Only quotes created after this migration are queued. Older quotes receive a stable
  UUID but are not uploaded. Existing numeric IDs, quote navigation, and catalogue
  snapshots remain intact.
- A new quote, its items, and its immutable upload payload commit in one local
  transaction. API downtime does not affect local saving. The outbox stores the
  operation UUID, pending/synced/failed status, attempt count, next retry timestamp,
  last error, and validated acknowledgement.
- Electron main checks the queue every second and at startup, respecting persisted
  backoff. **Sync Now** immediately retries pending uploads, bypassing their countdown.
  Only one run can execute; repeated clicks share any active run.
  Axios requests time out after 10 seconds. Network failures, HTTP 429, and HTTP
  500/502/503/504 retry after 1, 2, 4, … seconds, capped at five minutes. Restarting
  preserves attempts and retry times, including interrupted requests.
- Other HTTP errors and invalid acknowledgements remain failed for review. The UI
  shows the quote number, error, attempts, and a retry countdown that updates every
  second for transient failures, plus feedback after a manual sync attempt.
  Sync Now does not reset failures or mutate their payloads. This feature does not
  include a failure-editing or approval workflow.
- `GET /health` returns `200 {"status":"ok"}` after a database probe.
  `POST /quotes` accepts JSON in the shape below; unknown fields, invalid UUIDs,
  duplicate products, unsafe money/quantities, and invalid discounts are rejected.

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

The server recalculates line totals, subtotal, and final total with safe integer
paise arithmetic. Uploaded prices are **draft snapshots**, never approved prices.
A new upload returns HTTP 201 with `operationId`, `quoteId` (the global UUID),
`payloadHash` (SHA-256 of recursively key-sorted JSON), `status: "draft"`,
`receivedAt`, `subtotalPaise`, and `totalPaise`. The quote and this receipt commit
atomically. Repeating identical content with the same operation returns HTTP 200
and the original acknowledgement, even after restart. JSON object key order is
ignored; array order and values are significant. Reusing an operation UUID with
different content, or a quote UUID under a different operation, returns HTTP 409.
Validation failures return HTTP 422, malformed JSON 400, and oversized bodies 413.

Electron marks an upload synced only after checking the acknowledgement's IDs,
payload hash, draft status, timestamp, and recalculated totals. Losing a response
after the server commits therefore results in safe duplicate delivery. The renderer
receives only `syncNow()` and `getSyncStatus()` IPC methods; it cannot select URLs,
change payloads, or access the databases. The API currently has no authentication.
See [server deployment documentation](server/README.md) for the EC2 server setup.

### Verification

```bash
pnpm typecheck
pnpm api:typecheck
pnpm lint                # covers both packages
pnpm test                # uses Electron's Node runtime for native SQLite
pnpm api:test            # uses ordinary Node, with temporary localhost listeners
```

Tests cover duplicate delivery and API restart, local and server transaction rollback,
immutable snapshots, migrations without historical uploads, interrupted-client
recovery, single-run concurrency, capped retries, permanent failures, acknowledgement
validation, and Axios HTTP transport.
