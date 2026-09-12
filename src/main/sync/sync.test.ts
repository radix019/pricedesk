import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../database'
import { createQuoteRepository } from '../database/quotes'
import { createSyncService, createTransport, retryDelay, type UploadResponse } from './index'
import type { UploadPayload } from '../../shared/sync'
import { calculateTotals } from '../../shared/money'
import { createServer } from 'node:http'

const input = {
  customerName: 'Offline customer',
  discountPaise: 1,
  items: [{ productId: 1, quantity: 2 }]
}

function acknowledgement(payload: string): UploadResponse {
  const upload = JSON.parse(payload) as UploadPayload
  const totals = calculateTotals(upload.quote.items, upload.quote.discountPaise)
  return {
    status: 201,
    data: {
      operationId: upload.operationId,
      quoteId: upload.quote.globalId,
      status: 'draft',
      payloadHash: createHash('sha256').update(payload).digest('hex'),
      receivedAt: new Date().toISOString(),
      subtotalPaise: totals.subtotalPaise,
      totalPaise: totals.totalPaise
    }
  }
}

test('lost acknowledgement and restart redeliver the same persisted operation and payload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-sync-'))
  let db = openDatabase(directory)
  let time = 1000
  let firstPayload = ''
  try {
    createQuoteRepository(db).createQuote(input)
    const first = createSyncService(
      db,
      async (payload) => {
        firstPayload = payload
        throw new Error('Connection lost after server commit')
      },
      () => time
    )
    let status = await first.syncNow()
    assert.equal(status.pendingCount, 1)
    assert.equal(status.failures[0].attemptCount, 1)
    assert.equal(status.failures[0].nextRetryAt, 2000)
    await first.stop()
    db.close()
    db = openDatabase(directory)
    let deliveries = 0
    const restarted = createSyncService(
      db,
      async (payload) => {
        deliveries++
        assert.equal(payload, firstPayload)
        return acknowledgement(payload)
      },
      () => time
    )
    await restarted.syncNow()
    assert.equal(deliveries, 0)
    time = 2000
    status = await restarted.syncNow()
    assert.equal(deliveries, 1)
    assert.equal(status.syncedCount, 1)
    assert.equal(status.pendingCount, 0)
    assert.deepEqual(status.failures, [])
    await restarted.stop()
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('concurrent sync calls share one request; interrupted attempt recovers after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-interrupted-'))
  let db = openDatabase(directory)
  try {
    createQuoteRepository(db).createQuote(input)
    let calls = 0
    const service = createSyncService(
      db,
      (_payload, signal) => {
        calls++
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Shutdown')))
        )
      },
      () => 0
    )
    const first = service.syncNow()
    assert.equal(service.syncNow(), first)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls, 1)
    assert.equal(service.getSyncStatus().running, true)
    await service.stop()
    db.close()
    db = openDatabase(directory)
    const recovered = createSyncService(
      db,
      async (payload) => acknowledgement(payload),
      () => 1000
    )
    assert.equal((await recovered.syncNow()).syncedCount, 1)
    const attempts = db.prepare('SELECT attemptCount FROM quote_outbox').get() as {
      attemptCount: number
    }
    assert.equal(attempts.attemptCount, 2)
    await recovered.stop()
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('retryable errors back off; validation, conflict and invalid acknowledgements require review', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-retries-'))
  const db = openDatabase(directory)
  try {
    for (const response of [429, 500, 502, 503, 504, 400, 409, 422, 501, 201]) {
      db.exec('DELETE FROM quote_outbox; DELETE FROM quote_items; DELETE FROM quotes')
      createQuoteRepository(db).createQuote(input)
      let calls = 0
      let time = 0
      const service = createSyncService(
        db,
        async () => {
          calls++
          return { status: response, data: {} }
        },
        () => time
      )
      const status = await service.syncNow()
      const retry = [429, 500, 502, 503, 504].includes(response)
      assert.equal(status.failedCount, retry ? 0 : 1)
      assert.equal(status.pendingCount, retry ? 1 : 0)
      assert.equal(status.syncedCount, 0)
      await service.syncNow()
      assert.equal(calls, 1)
      time = 1000
      await service.syncNow()
      assert.equal(calls, retry ? 2 : 1)
      if (retry) assert.equal(service.getSyncStatus().failures[0].nextRetryAt, 3000)
      await service.stop()
    }
    assert.equal(retryDelay(1000), 300_000)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Axios transport sends immutable JSON over loopback and supports shutdown cancellation', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/quotes') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        res.end(body)
      })
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const transport = createTransport(String(address.port))
    const response = await transport('{"operationId":"example"}', new AbortController().signal)
    assert.equal(response.status, 200)
    assert.deepEqual(response.data, { operationId: 'example' })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(transport('{}', controller.signal))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('each acknowledgement field must match before an upload can be marked synced', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-ack-'))
  const db = openDatabase(directory)
  try {
    for (const [key, value] of Object.entries({
      operationId: 'wrong-operation',
      quoteId: 'wrong-quote',
      payloadHash: 'wrong-hash',
      status: 'approved',
      receivedAt: 'invalid-time',
      subtotalPaise: 0,
      totalPaise: 0
    })) {
      db.exec('DELETE FROM quote_outbox; DELETE FROM quote_items; DELETE FROM quotes')
      createQuoteRepository(db).createQuote(input)
      const service = createSyncService(db, async (payload) => {
        const response = acknowledgement(payload)
        return { ...response, data: { ...(response.data as object), [key]: value } }
      })
      const status = await service.syncNow()
      assert.equal(status.syncedCount, 0, key)
      assert.equal(status.failedCount, 1, key)
      await service.stop()
    }
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
