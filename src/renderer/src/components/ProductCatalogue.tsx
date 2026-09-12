import { useEffect, useState } from 'react'
import type { Product } from '../../../preload/api'

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
      <h1 id="catalogue-title">PriceDesk product catalogue</h1>
      {loading ? (
        <p role="status">Loading products…</p>
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
        <p role="status">No products yet.</p>
      ) : (
        <table>
          <caption>Prices in Indian rupees</caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Name</th>
              <th scope="col" className="price">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td className="price">{formatPrice.format(product.pricePaise / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
