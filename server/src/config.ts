import { isIP } from 'node:net'
import { isAbsolute, resolve } from 'node:path'

export interface ApiConfig {
  port: number
  host: string
  databasePath: string
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === 'production'
  const port = env.PORT ?? env.PRICEDESK_API_PORT ?? '4317'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('PORT must be an integer between 1 and 65535')
  const host = env.HOST ?? '127.0.0.1'
  if (!isIP(host)) throw new Error('HOST must be an IP address')
  if (production && host !== '127.0.0.1')
    throw new Error('Production HOST must be 127.0.0.1; expose the API through a reverse proxy')
  const databasePath =
    env.DATABASE_PATH ??
    env.PRICEDESK_API_DB ??
    (production ? '/var/lib/pricedesk/pricedesk.sqlite' : 'data/pricedesk-api.sqlite')
  if (!databasePath.trim() || databasePath === ':memory:' || databasePath.includes('\0'))
    throw new Error('DATABASE_PATH must name a persistent SQLite file')
  if (production && !isAbsolute(databasePath))
    throw new Error('Production DATABASE_PATH must be absolute and outside the release directory')
  return { port: Number(port), host, databasePath: resolve(databasePath) }
}
