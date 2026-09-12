import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateTotals, rupeesToPaise } from './money'

test('rupee text converts exactly to integer paise', () => {
  for (const [input, expected] of [
    ['0', 0],
    ['0.01', 1],
    ['1.1', 110],
    ['12.34', 1234],
    ['999.99', 99999]
  ] as const) {
    assert.equal(rupeesToPaise(input), expected)
  }
  for (const input of ['', '-1', '1.001', '1e2', 'NaN', '1,000', '1.', ' 1', '90071992547410']) {
    assert.throws(() => rupeesToPaise(input))
  }
})

test('totals use paise, including zero and full discounts', () => {
  const rows = [
    { unitPricePaise: 9900, quantity: 2 },
    { unitPricePaise: 1500, quantity: 3 }
  ]
  assert.deepEqual(calculateTotals(rows, 1234), {
    subtotalPaise: 24300,
    totalPaise: 23066,
    lineTotals: [19800, 4500]
  })
  assert.equal(calculateTotals(rows, 0).totalPaise, 24300)
  assert.equal(calculateTotals(rows, 24300).totalPaise, 0)
  assert.equal(calculateTotals([{ unitPricePaise: 0, quantity: 1 }], 0).totalPaise, 0)
})

test('invalid quantities, money, excessive discount and overflow are rejected', () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateTotals([{ unitPricePaise: 100, quantity }], 0))
  }
  for (const discount of [-1, 0.1, 101, Infinity]) {
    assert.throws(() => calculateTotals([{ unitPricePaise: 100, quantity: 1 }], discount))
  }
  assert.throws(() => calculateTotals([], 0))
  assert.throws(() => calculateTotals([{ unitPricePaise: 1.5, quantity: 1 }], 0))
  assert.throws(() =>
    calculateTotals([{ unitPricePaise: Number.MAX_SAFE_INTEGER, quantity: 2 }], 0)
  )
  assert.throws(() =>
    calculateTotals(
      [
        { unitPricePaise: Number.MAX_SAFE_INTEGER, quantity: 1 },
        { unitPricePaise: 1, quantity: 1 }
      ],
      0
    )
  )
})
