import axios from 'axios'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { calculateTotals } from '../../shared/money'
import type { SyncStatus, UploadPayload } from '../../shared/sync'

interface OutboxRow {
  operationId: string
  payload: string
  attemptCount: number
}

export interface UploadResponse {
  status: number
  data: unknown
}
type Transport = (payload: string, signal: AbortSignal) => Promise<UploadResponse>

export function createTransport(port = '4317'): Transport {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Invalid API port')
  const client = axios.create({
    baseURL: `http://127.0.0.1:${port}`,
    timeout: 10_000,
    maxRedirects: 0,
    maxContentLength: 64 * 1024,
    proxy: false,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' }
  })
  return (payload, signal) => client.post('/quotes', payload, { signal })
}

export function retryDelay(attempt: number): number {
  return Math.min(300_000, 1000 * 2 ** Math.min(18, Math.max(0, attempt - 1)))
}

function validAcknowledgement(data: unknown, row: OutboxRow): boolean {
  if (!data || typeof data !== 'object') return false
  const ack = data as Record<string, unknown>
  const payload = JSON.parse(row.payload) as UploadPayload
  const totals = calculateTotals(payload.quote.items, payload.quote.discountPaise)
  return (
    ack.operationId === row.operationId &&
    ack.quoteId === payload.quote.globalId &&
    ack.payloadHash === createHash('sha256').update(row.payload).digest('hex') &&
    ack.status === 'draft' &&
    typeof ack.receivedAt === 'string' &&
    Number.isFinite(Date.parse(ack.receivedAt)) &&
    ack.subtotalPaise === totals.subtotalPaise &&
    ack.totalPaise === totals.totalPaise
  )
}

export function createSyncService(
  database: Database.Database,
  transport: Transport = createTransport(),
  now: () => number = Date.now
): {
  syncNow: () => Promise<SyncStatus>
  getSyncStatus: () => SyncStatus
  start: () => void
  stop: () => Promise<void>
} {
  let active: Promise<SyncStatus> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false
  const controller = new AbortController()
  const due = database.prepare<[number], OutboxRow>(`SELECT operationId, payload, attemptCount
    FROM quote_outbox WHERE status = 'pending' AND nextRetryAt <= ? ORDER BY nextRetryAt, rowid`)
  const attempt = database.prepare(`UPDATE quote_outbox SET attemptCount = attemptCount + 1,
    nextRetryAt = ? WHERE operationId = ?`)
  const fail = database.prepare(
    `UPDATE quote_outbox SET status = ?, nextRetryAt = ?, lastError = ? WHERE operationId = ?`
  )
  const synced = database.prepare(`UPDATE quote_outbox SET status = 'synced', nextRetryAt = NULL,
    lastError = NULL, acknowledgement = ? WHERE operationId = ?`)

  function getSyncStatus(): SyncStatus {
    const counts = database
      .prepare<[], { status: string; n: number }>(
        'SELECT status, count(*) AS n FROM quote_outbox GROUP BY status'
      )
      .all()
    const count = (status: string): number => counts.find((row) => row.status === status)?.n ?? 0
    return {
      running: !!active,
      pendingCount: count('pending'),
      syncedCount: count('synced'),
      failedCount: count('failed'),
      failures: database
        .prepare<[], SyncStatus['failures'][number]>(
          `SELECT quoteId, operationId, status,
        attemptCount, nextRetryAt, lastError FROM quote_outbox WHERE lastError IS NOT NULL AND status != 'synced'
        ORDER BY quoteId DESC`
        )
        .all()
    }
  }

  async function run(): Promise<void> {
    for (const row of due.all(now())) {
      if (stopped) break
      const nextRetryAt = now() + retryDelay(row.attemptCount + 1)
      // Leave the row pending and record the attempt before I/O. A crash needs no lease reset.
      attempt.run(nextRetryAt, row.operationId)
      try {
        const response = await transport(row.payload, controller.signal)
        if (response.status >= 200 && response.status < 300) {
          if (validAcknowledgement(response.data, row)) {
            synced.run(JSON.stringify(response.data), row.operationId)
          } else {
            fail.run(
              'failed',
              null,
              'Invalid server acknowledgement; review required',
              row.operationId
            )
          }
        } else {
          const retry = response.status === 429 || [500, 502, 503, 504].includes(response.status)
          const detail =
            response.data &&
            typeof response.data === 'object' &&
            'error' in response.data &&
            typeof response.data.error === 'string'
              ? `: ${response.data.error.slice(0, 500)}`
              : ''
          fail.run(
            retry ? 'pending' : 'failed',
            retry ? now() + retryDelay(row.attemptCount + 1) : null,
            `HTTP ${response.status}${detail}`,
            row.operationId
          )
        }
      } catch (error) {
        if (stopped) break
        fail.run(
          'pending',
          now() + retryDelay(row.attemptCount + 1),
          error instanceof Error ? error.message.slice(0, 500) : 'Network request failed',
          row.operationId
        )
      }
    }
  }

  function syncNow(): Promise<SyncStatus> {
    if (active) return active
    if (stopped) return Promise.resolve(getSyncStatus())
    active = Promise.resolve()
      .then(run)
      .then(
        () => {
          active = undefined
          return getSyncStatus()
        },
        (error) => {
          active = undefined
          throw error
        }
      )
    return active
  }
  return {
    syncNow,
    getSyncStatus,
    start: () => {
      if (timer || stopped) return
      const tick = (): void => {
        void syncNow().catch((error) => console.error('Quote sync failed', error))
      }
      timer = setInterval(tick, 1000)
      tick()
    },
    stop: async () => {
      stopped = true
      clearInterval(timer)
      controller.abort()
      await active
    }
  }
}
