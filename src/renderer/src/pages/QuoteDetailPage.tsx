import {
  Alert,
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
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuoteQuery } from '../queries/ipc'
import QuoteExcelExport from '../components/QuoteExcelExport'

const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

export default function QuoteDetailPage(): React.JSX.Element {
  const { id: parameter } = useParams()
  const id = parameter && /^[1-9]\d*$/.test(parameter) ? Number(parameter) : NaN
  const validId = Number.isSafeInteger(id) && id > 0
  const query = useQuoteQuery(id)
  const location = useLocation()
  const state: unknown = location.state
  const saved =
    typeof state === 'object' &&
    state !== null &&
    'savedQuoteId' in state &&
    state.savedQuoteId === id
  if (!validId)
    return (
      <Alert severity="info">
        Invalid quote ID. <Link to="/quotes">Back to quotes</Link>
      </Alert>
    )
  if (query.isPending) return <Typography role="status">Loading quote…</Typography>
  if (query.isError)
    return (
      <Alert
        severity="error"
        action={
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      >
        Could not load quote.
      </Alert>
    )
  const quote = query.data
  if (!quote)
    return (
      <Alert severity="info">
        Quote not found. <Link to="/quotes">Back to quotes</Link>
      </Alert>
    )
  return (
    <Stack spacing={2}>
      <Button component={Link} to="/quotes" sx={{ alignSelf: 'start' }}>
        Back to quotes
      </Button>
      {saved && (
        <Alert severity="success">
          Quote #{quote.id} saved for {quote.customerName}.
        </Alert>
      )}
      <QuoteExcelExport key={quote.id} quoteId={quote.id} />
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
    </Stack>
  )
}
