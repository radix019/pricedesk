import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readConfig } from './config'

test('production defaults keep the database outside releases and HTTP on loopback', () => {
  assert.deepEqual(readConfig({ NODE_ENV: 'production' }), {
    port: 4317,
    host: '127.0.0.1',
    databasePath: '/var/lib/pricedesk/pricedesk.sqlite'
  })
  assert.equal(readConfig({}).databasePath, resolve('data/pricedesk-api.sqlite'))
})

test('new settings take precedence while legacy local configuration keeps working', () => {
  const legacy = { PRICEDESK_API_PORT: '4321', PRICEDESK_API_DB: 'existing.sqlite' }
  assert.equal(readConfig(legacy).port, 4321)
  assert.equal(readConfig(legacy).databasePath, resolve('existing.sqlite'))
  assert.deepEqual(
    readConfig({ ...legacy, PORT: '4322', HOST: '::1', DATABASE_PATH: '/tmp/custom.sqlite' }),
    { port: 4322, host: '::1', databasePath: '/tmp/custom.sqlite' }
  )
})

test('invalid settings and unsafe production binds fail before opening any database', () => {
  for (const PORT of ['', '0', '-1', '65536', '4317.0', '4e3', ' 4317'])
    assert.throws(() => readConfig({ PORT }), /PORT/)
  assert.throws(() => readConfig({ HOST: 'invalid' }), /HOST/)
  assert.throws(() => readConfig({ NODE_ENV: 'production', HOST: '0.0.0.0' }), /HOST/)
  assert.throws(
    () => readConfig({ NODE_ENV: 'production', DATABASE_PATH: 'db.sqlite' }),
    /absolute/
  )
  for (const DATABASE_PATH of ['', ':memory:', 'bad\0path'])
    assert.throws(() => readConfig({ DATABASE_PATH }), /DATABASE_PATH/)
})
