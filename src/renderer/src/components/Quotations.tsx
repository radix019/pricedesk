import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material'
import type { Product, Quote, QuoteSummary } from '../../../preload/api'
import QuoteForm from './QuoteForm'

const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

function QuoteDetail({ id }: { id: number }): React.JSX.Element {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    window.api.getQuote(id).then(
      (value) => {
        if (active) {
          setQuote(value)
          setLoading(false)
        }
      },
      () => {
        if (active) {
          setError(true)
          setLoading(false)
        }
      }
    )
    return () => {
      active = false
    }
  }, [id, attempt])
  if (loading) return <Typography role="status">Loading quote…</Typography>
  if (error)
    return (
      <Alert
        severity="error"
        action={
          <Button
            onClick={() => {
              setError(false)
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          >
            Retry
          </Button>
        }
      >
        Could not load quote.
      </Alert>
    )
  if (!quote) return <Alert severity="info">Quote not found.</Alert>
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" component="h3">
        Quote #{quote.id} — {quote.customerName}
      </Typography>
      <Typography>{new Date(quote.createdAt).toLocaleString()}</Typography>
      <TableContainer>
        <Table size="small" aria-label="Quote items">
          <TableHead>
            <TableRow>
              <TableCell>SKU</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell align="right">Unit price</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {quote.items.map((item) => (
              <TableRow key={item.productId}>
                <TableCell>{item.sku}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell align="right">{item.quantity}</TableCell>
                <TableCell align="right">{format.format(item.unitPricePaise / 100)}</TableCell>
                <TableCell align="right">{format.format(item.lineTotalPaise / 100)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography sx={{ mt: 2 }}>Subtotal: {format.format(quote.subtotalPaise / 100)}</Typography>
      <Typography>Discount: {format.format(quote.discountPaise / 100)}</Typography>
      <Typography sx={{ fontWeight: 'bold' }}>
        Total: {format.format(quote.totalPaise / 100)}
      </Typography>
    </Paper>
  )
}

export default function Quotations(): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [quotes, setQuotes] = useState<QuoteSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    Promise.all([window.api.getProducts(), window.api.listQuotes()]).then(
      ([rows, saved]) => {
        if (active) {
          setProducts(rows)
          setQuotes(saved)
          setLoading(false)
        }
      },
      () => {
        if (active) {
          setError(true)
          setLoading(false)
        }
      }
    )
    return () => {
      active = false
    }
  }, [attempt])
  return (
    <Box component="section" sx={{ width: 'min(800px, calc(100vw - 32px))', mt: 4 }}>
      {loading ? (
        <Typography role="status">Loading quotations…</Typography>
      ) : error ? (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                setLoading(true)
                setError(false)
                setAttempt((value) => value + 1)
              }}
            >
              Retry
            </Button>
          }
        >
          Could not load quotations.
        </Alert>
      ) : (
        <Stack spacing={3}>
          <QuoteForm
            products={products}
            onSaved={(quote) => {
              setQuotes((current) => [quote, ...current])
              setSelected(quote.id)
            }}
          />
          <Typography variant="h5" component="h2">
            Saved quotes
          </Typography>
          {quotes.length === 0 ? (
            <Typography>No saved quotes yet.</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="Saved quotes">
                <TableHead>
                  <TableRow>
                    <TableCell>Quote</TableCell>
                    <TableCell>Customer</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {quotes.map((quote) => (
                    <TableRow key={quote.id} selected={selected === quote.id}>
                      <TableCell>
                        <Button onClick={() => setSelected(quote.id)}>View #{quote.id}</Button>
                      </TableCell>
                      <TableCell>{quote.customerName}</TableCell>
                      <TableCell>{new Date(quote.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell align="right">{format.format(quote.totalPaise / 100)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {selected !== null && <QuoteDetail key={selected} id={selected} />}
        </Stack>
      )}
    </Box>
  )
}
