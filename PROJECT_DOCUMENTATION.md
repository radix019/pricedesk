# PriceDesk

PriceDesk is an offline Electron application: the React/TypeScript renderer displays products and quotations, while the main process manages windows, validates requests, and accesses SQLite.
A sandboxed, context-isolated preload exposes a narrow typed `window.api` bridge; IPC connects the UI to main-process handlers.

## Main-process API

These functions are available to React through `window.api`. Their handlers live in `src/main/ipc.ts` and are registered by `src/main/index.ts`.

| Function | IPC channel | Purpose |
| --- | --- | --- |
| `getAppVersion(): Promise<string>` | `app:get-version` | Returns the application's version. |
| `getProducts(): Promise<Product[]>` | `products:get-all` | Returns catalogue products, including SKU, name, and price in paise. |
| `createQuote(input: CreateQuoteInput): Promise<Quote>` | `quotes:create` | Validates the request, reads current product prices, calculates totals, and saves the quote and item snapshots in one transaction. |
| `listQuotes(): Promise<QuoteSummary[]>` | `quotes:list` | Returns saved quote summaries, newest ID first. |
| `getQuote(id: number): Promise<Quote \| null>` | `quotes:get` | Returns a quote with its saved item snapshots, or `null` if it does not exist. |

`CreateQuoteInput` contains `customerName`, `items: { productId, quantity }[]`, and `discountPaise`. Main rejects duplicate products, invalid quantities, and discounts above the subtotal; the renderer cannot supply authoritative prices or totals.

## Key files

- `src/main/index.ts`: Starts Electron, opens the database after app readiness, registers IPC handlers, creates the window, and closes SQLite on quit.
- `src/main/database/`: Separates database initialization, versioned transactional migrations, and prepared-statement product/quote repositories. Data lives in `pricedesk.sqlite` under `app.getPath('userData')`, with foreign keys enabled.
- `src/main/ipc.ts`: Checks the sending window, main frame, and URL before dispatching API calls.
- `src/preload/index.ts` and `api.d.ts`: Expose the named API methods and define their shared TypeScript contracts. The existing runtime-version footer receives version data separately through `window.electron`.
- `src/renderer/src/`: Contains the catalogue, MUI/Formik/Yup quote form, saved-quotes list, and detail view.
- `src/shared/money.ts`: Converts rupee input to integer paise and checks monetary calculations. All stored monetary values use paise; saved item snapshots preserve historical SKU, name, and unit price.

## Navigation and renderer state

`main.tsx` provides one stable QueryClient and a HashRouter, so packaged URLs such as `index.html#/quotes/1` work without a web server. `App.tsx` lazy-loads the `/products`, `/quotes`, `/quotes/new`, `/quotes/:id`, and not-found pages inside a shared MUI navigation layout with a Suspense loading state.

- `src/renderer/src/queries/ipc.ts`: Typed hooks call the existing preload API using `['products']`, `['quotes']`, and `['quotes', id]` keys. The quote-creation mutation caches the saved detail and invalidates the quotes list before navigating to the saved quote.
- Local IPC queries and mutations use `networkMode: 'always'` and no automatic retries. These options are scoped to IPC hooks; future remote HTTP operations retain TanStack Query's default network behavior.
- `src/renderer/src/stores/sidebar.ts`: Zustand holds only sidebar visibility and its actions. Form drafts stay in Formik, and database records stay in the Query cache.

To check offline navigation, build and open PriceDesk, set DevTools Network to **Offline**, navigate between products and quotes, and save a new quote. Confirm its detail opens, the saved list includes it, and reloading its hash URL still works.

## Development checks

Run `pnpm dev` to start development, `pnpm typecheck` and `pnpm lint` for static checks, and `pnpm test` for calculation and database tests, including transaction rollback.
