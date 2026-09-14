import { createServer, type Server } from 'node:http'
import { createApi } from './app'
import { openApiDatabase } from './database'
import type { ApiConfig } from './config'

export async function startApi(config: ApiConfig): Promise<{
  server: Server
  close: () => Promise<void>
}> {
  // Complete migrations before accepting requests. A failed migration never listens.
  const db = openApiDatabase(config.databasePath)
  const server = createServer(createApi(db))
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.keepAliveTimeout = 5_000
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error) {
    db.close()
    throw error
  }
  let closing: Promise<void> | undefined
  return {
    server,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        // Drain active HTTP requests before closing SQLite. Bound slow/incomplete clients.
        const deadline = setTimeout(() => server.closeAllConnections(), 15_000)
        deadline.unref()
        server.close((error) => {
          clearTimeout(deadline)
          try {
            db.close()
            if (error) reject(error)
            else resolve()
          } catch (closeError) {
            reject(closeError)
          }
        })
      })
      return closing
    }
  }
}
