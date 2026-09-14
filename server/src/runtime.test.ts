import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { startApi } from './runtime'
import { openApiDatabase } from './database'

test('shutdown drains an in-flight upload; restart returns the persisted receipt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-shutdown-'))
  const config = { host: '127.0.0.1', port: 0, databasePath: join(directory, 'api.sqlite') }
  let api = await startApi(config)
  try {
    const address = api.server.address()
    assert.ok(address && typeof address === 'object')
    const payload = JSON.stringify({
      operationId: randomUUID(),
      quote: {
        globalId: randomUUID(),
        customerName: 'Drain test',
        createdAt: '2026-09-12T00:00:00.000Z',
        discountPaise: 0,
        items: [{ productId: 1, sku: 'SKU', name: 'Snapshot', unitPricePaise: 100, quantity: 1 }]
      }
    })
    const received = once(api.server, 'request')
    const upload = request({
      host: config.host,
      port: address.port,
      path: '/quotes',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    })
    const response = new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        upload.on('error', reject)
        upload.on('response', (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => resolve({ status: res.statusCode, body }))
          res.on('error', reject)
        })
      }
    )
    upload.write(payload.slice(0, 20))
    await received
    const closing = api.close()
    assert.equal(api.close(), closing)
    upload.end(payload.slice(20))
    const original = await response
    assert.equal(original.status, 201)
    await closing
    api = await startApi(config)
    const restarted = api.server.address()
    assert.ok(restarted && typeof restarted === 'object')
    const replay = await fetch(`http://${config.host}:${restarted.port}/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    })
    assert.equal(replay.status, 200)
    assert.deepEqual(await replay.json(), JSON.parse(original.body))
    await assert.rejects(startApi({ ...config, port: restarted.port }), /EADDRINUSE/)
    assert.equal((await fetch(`http://${config.host}:${restarted.port}/health`)).status, 200)
  } finally {
    await api.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('failed startup migration leaves the database unchanged and never starts HTTP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pricedesk-startup-failure-'))
  const databasePath = join(directory, 'api.sqlite')
  const db = openApiDatabase(databasePath)
  db.exec('PRAGMA user_version = 99')
  try {
    await assert.rejects(startApi({ host: '127.0.0.1', port: 0, databasePath }), /newer/)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 99)
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
