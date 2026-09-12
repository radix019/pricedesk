import { resolve } from 'node:path'
import { openApiDatabase } from './database'
import { createApi } from './app'

const port = Number(process.env.PRICEDESK_API_PORT ?? 4317)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port')
const db = openApiDatabase(resolve(process.env.PRICEDESK_API_DB ?? 'data/pricedesk-api.sqlite'))
const server = createApi(db).listen(port, '127.0.0.1', () => {
  console.log(`PriceDesk development API: http://127.0.0.1:${port}`)
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () =>
    server.close(() => {
      db.close()
    })
  )
}
