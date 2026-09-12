import express, { type ErrorRequestHandler } from 'express'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { canonicalJson, isUuid, type QuoteAcknowledgement } from '../../src/shared/sync'
import { calculateTotals } from '../../src/shared/money'
import { validateUpload } from './validation'
import { isDatabaseBusy, rollbackAfterError } from './database'

export function createApi(db: DatabaseSync): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '512kb', strict: true }))
  app.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get()
    res.json({ status: 'ok' })
  })
  app.post('/quotes', (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Expected application/json' })
      return
    }
    const body: unknown = req.body
    if (
      !body ||
      typeof body !== 'object' ||
      !('operationId' in body) ||
      !isUuid(body.operationId)
    ) {
      res.status(422).json({ error: 'Invalid operation UUID' })
      return
    }
    const payload = canonicalJson(body)
    db.exec('BEGIN IMMEDIATE')
    try {
      const receipt = db
        .prepare('SELECT payload, acknowledgement FROM receipts WHERE operationId = ?')
        .get(body.operationId)
      if (receipt) {
        db.exec('COMMIT')
        if (receipt.payload !== payload)
          res.status(409).json({ error: 'Operation UUID already used with different content' })
        else res.status(200).json(JSON.parse(receipt.acknowledgement as string))
        return
      }
      let upload
      try {
        upload = validateUpload(body)
      } catch (error) {
        db.exec('ROLLBACK')
        res.status(422).json({ error: error instanceof Error ? error.message : 'Invalid quote' })
        return
      }
      const quote = upload.quote
      if (db.prepare('SELECT 1 FROM quotes WHERE globalId = ?').get(quote.globalId)) {
        db.exec('ROLLBACK')
        res.status(409).json({ error: 'Quote UUID already uploaded under another operation' })
        return
      }
      const totals = calculateTotals(quote.items, quote.discountPaise)
      const acknowledgement: QuoteAcknowledgement = {
        operationId: upload.operationId,
        quoteId: quote.globalId,
        payloadHash: createHash('sha256').update(payload).digest('hex'),
        status: 'draft',
        receivedAt: new Date().toISOString(),
        subtotalPaise: totals.subtotalPaise,
        totalPaise: totals.totalPaise
      }
      db.prepare('INSERT INTO quotes VALUES (?, ?, ?, ?, ?, ?)').run(
        quote.globalId,
        canonicalJson({
          ...quote,
          items: quote.items.map((item, index) => ({
            ...item,
            lineTotalPaise: totals.lineTotals[index]
          }))
        }),
        'draft',
        totals.subtotalPaise,
        quote.discountPaise,
        totals.totalPaise
      )
      db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?)').run(
        upload.operationId,
        quote.globalId,
        payload,
        JSON.stringify(acknowledgement)
      )
      db.exec('COMMIT')
      res.status(201).json(acknowledgement)
    } catch (error) {
      rollbackAfterError(db)
      throw error
    }
  })
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }
    if (isDatabaseBusy(error)) {
      res.setHeader('Retry-After', '5')
      res.status(503).json({
        error: 'Database is busy. Finish pending changes in other database connections and retry.'
      })
      return
    }
    const status = error.status === 413 ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
    if (status === 500) console.error('API request failed', error)
    res
      .status(status)
      .json({ error: status === 500 ? 'Internal server error' : 'Invalid JSON request' })
  }
  app.use(errors)
  return app
}
