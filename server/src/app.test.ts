import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from './app'
import { openApiDatabase } from './database'
import { canonicalJson } from '../../src/shared/sync'
import { DatabaseSync } from 'node:sqlite'

const upload = (): object => ({
  operationId: randomUUID(),
  quote: {
    globalId: randomUUID(),
    customerName: 'Customer',
    createdAt: '2026-09-12T00:00:00.000Z',
    discountPaise: 1,
    items: [{ productId: 1, sku: 'PD-001', name: 'Snapshot', unitPricePaise: 101, quantity: 3 }]
  }
})

async function fixture(path = ':memory:'): Promise<{
  db: ReturnType<typeof openApiDatabase>
  post: (body: unknown) => Promise<Response>
  health: () => Promise<Response>
  close: () => Promise<void>
}> {
  const db = openApiDatabase(path)
  const server = createApi(db).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  return {
    db,
    post: (body) =>
      fetch(`${base}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }),
    health: () => fetch(`${base}/health`),
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      db.close()
    }
  }
}

test('concurrent duplicates return the original acknowledgement, including after API restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-api-'))
  const path = join(directory, 'api.sqlite')
  let api = await fixture(path)
  try {
    assert.equal((await api.health()).status, 200)
    const payload = upload()
    const responses = await Promise.all([api.post(payload), api.post(payload)])
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201])
    const original = await responses[0].json()
    assert.deepEqual(await responses[1].json(), original)
    assert.equal(original.subtotalPaise, 303)
    assert.equal(original.totalPaise, 302)
    assert.equal(original.status, 'draft')
    assert.equal(
      original.payloadHash,
      createHash('sha256').update(canonicalJson(payload)).digest('hex')
    )
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM quotes').get()!.n, 1)
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM receipts').get()!.n, 1)
    const stored = api.db.prepare('SELECT * FROM quotes').get()!
    assert.equal(stored.priceStatus, 'draft')
    assert.equal(JSON.parse(stored.snapshot as string).items[0].lineTotalPaise, 303)
    await api.close()
    api = await fixture(path)
    const replay = await api.post(payload)
    assert.equal(replay.status, 200)
    assert.deepEqual(await replay.json(), original)
    const changed = JSON.parse(JSON.stringify(payload))
    changed.quote.items[0].unitPricePaise++
    assert.equal((await api.post(changed)).status, 409)
    changed.quote = null
    assert.equal((await api.post(changed)).status, 409)
    const otherOperation = { ...payload, operationId: randomUUID() }
    assert.equal((await api.post(otherOperation)).status, 409)
    const reordered = Object.fromEntries(Object.entries(payload).reverse())
    assert.equal((await api.post(reordered)).status, 200)
  } finally {
    await api.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('receipt failure rolls back the quote and permits later delivery', async () => {
  const api = await fixture()
  try {
    const payload = upload()
    api.db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts
      BEGIN SELECT RAISE(ABORT, 'Injected receipt failure'); END`)
    assert.equal((await api.post(payload)).status, 500)
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM quotes').get()!.n, 0)
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM receipts').get()!.n, 0)
    api.db.exec('DROP TRIGGER fail_receipt')
    assert.equal((await api.post(payload)).status, 201)
  } finally {
    await api.close()
  }
})

test('a competing writer returns a retryable response and uploads recover when the lock is released', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-api-busy-'))
  const path = join(directory, 'api.sqlite')
  const api = await fixture(path)
  const writer = new DatabaseSync(path)
  try {
    api.db.exec('PRAGMA busy_timeout = 0')
    writer.exec('BEGIN IMMEDIATE')
    const payload = upload()
    const response = await api.post(payload)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Retry-After'), '5')
    assert.match((await response.json()).error, /Database is busy/)
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM quotes').get()!.n, 0)
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM receipts').get()!.n, 0)
    writer.exec('ROLLBACK')
    assert.equal((await api.post(payload)).status, 201)
    assert.equal((await api.post(payload)).status, 200)
  } finally {
    writer.close()
    await api.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('invalid snapshots, forged totals, overflow and duplicates are rejected without writes', async () => {
  const api = await fixture()
  try {
    for (const mutate of [
      (q) => {
        q.customerName = ' '
      },
      (q) => {
        q.globalId = '1'
      },
      (q) => {
        q.createdAt = 'yesterday'
      },
      (q) => {
        q.discountPaise = 9999
      },
      (q) => {
        q.totalPaise = 1
      },
      (q) => {
        q.priceStatus = 'approved'
      },
      (q) => {
        q.items = []
      },
      (q) => {
        q.items.push(q.items[0])
      },
      (q) => {
        q.items[0].quantity = 0
      },
      (q) => {
        q.items[0].unitPricePaise = -1
      },
      (q) => {
        q.items[0].unitPricePaise = 1.5
      },
      (q) => {
        q.items[0].unitPricePaise = Number.MAX_SAFE_INTEGER
      }
    ] as Array<(q: { [key: string]: unknown; items: Record<string, unknown>[] }) => void>) {
      const payload = JSON.parse(JSON.stringify(upload()))
      mutate(payload.quote)
      assert.equal((await api.post(payload)).status, 422)
    }
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM quotes').get()!.n, 0)
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM receipts').get()!.n, 0)
  } finally {
    await api.close()
  }
})
