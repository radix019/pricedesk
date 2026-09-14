export interface UploadPayload {
  operationId: string
  quote: {
    globalId: string
    customerName: string
    createdAt: string
    discountPaise: number
    items: {
      productId: number
      sku: string
      name: string
      unitPricePaise: number
      quantity: number
    }[]
  }
}

export interface QuoteAcknowledgement {
  operationId: string
  quoteId: string
  payloadHash: string
  status: 'draft'
  receivedAt: string
  subtotalPaise: number
  totalPaise: number
}

export interface SyncStatus {
  running: boolean
  pendingCount: number
  syncedCount: number
  failedCount: number
  failures: {
    quoteId: number
    operationId: string
    status: 'pending' | 'failed'
    attemptCount: number
    nextRetryAt: number | null
    lastError: string
  }[]
}

// Key order is irrelevant; array order and every supplied value remain significant.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
}
