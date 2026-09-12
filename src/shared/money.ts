export function requireInteger(value: unknown, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Expected a safe integer of at least ${minimum}`)
  }
}

export function rupeesToPaise(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error('Enter a non-negative amount with at most two decimal places')
  }
  const [rupees, fraction = ''] = value.split('.')
  const paise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (paise > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large')
  return Number(paise)
}

export function calculateTotals(
  items: { unitPricePaise: number; quantity: number }[],
  discountPaise: number
): { subtotalPaise: number; totalPaise: number; lineTotals: number[] } {
  requireInteger(discountPaise)
  if (items.length === 0) throw new Error('Add at least one product')
  let subtotalPaise = 0
  const lineTotals = items.map(({ unitPricePaise, quantity }) => {
    requireInteger(unitPricePaise)
    requireInteger(quantity, 1)
    const total = unitPricePaise * quantity
    requireInteger(total)
    subtotalPaise += total
    requireInteger(subtotalPaise)
    return total
  })
  if (discountPaise > subtotalPaise) throw new Error('Discount cannot exceed subtotal')
  return { subtotalPaise, totalPaise: subtotalPaise - discountPaise, lineTotals }
}
