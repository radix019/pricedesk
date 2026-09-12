import { useEffect, useState } from 'react'
import type { Product } from '../../../preload/api'
import { Typography } from '@mui/material'

const formatPrice = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

export default function ProductCatalogue(): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    window.api.getProducts().then(
      (rows) => {
        if (!active) return
        setProducts(rows)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Could not load products. Please try again.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [attempt])

  return (
    <section className="catalogue" aria-labelledby="catalogue-title" aria-busy={loading}>
      <Typography variant="h1" id="catalogue-title">
        PriceDesk product catalogue
      </Typography>
      {loading ? (
        <Typography role="status">Loading products…</Typography>
      ) : error ? (
        <div className="action">
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setError(null)
              setAttempt((value) => value + 1)
            }}
          >
            Retry
          </button>
        </div>
      ) : products.length === 0 ? (
        <Typography role="status">No products yet.</Typography>
      ) : (
        <table>
          <caption>Prices in Indian rupees</caption>
          <thead>
            <tr>
              <th scope="col">
                <Typography> SKU</Typography>
              </th>
              <th scope="col">
                <Typography>Name</Typography>
              </th>
              <th scope="col" className="price">
                <Typography>Price</Typography>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <Typography>{product.sku}</Typography>
                </td>
                <td>
                  <Typography>{product.name}</Typography>
                </td>
                <td className="price">
                  <Typography>{formatPrice.format(product.pricePaise / 100)}</Typography>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
