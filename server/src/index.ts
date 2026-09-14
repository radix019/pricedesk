import { readConfig } from './config'
import { startApi } from './runtime'

async function main(): Promise<void> {
  process.umask(0o077)
  const config = readConfig()
  const api = await startApi(config)
  console.log(`PriceDesk API: http://${config.host}:${config.port}`)
  const shutdown = (): void => {
    void api.close().catch((error) => {
      console.error('API shutdown failed', error)
      process.exitCode = 1
    })
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown)
  api.server.on('error', (error) => {
    console.error('API server failed', error)
    process.exitCode = 1
    shutdown()
  })
}

void main().catch((error) => {
  console.error('API startup failed', error)
  process.exitCode = 1
})
