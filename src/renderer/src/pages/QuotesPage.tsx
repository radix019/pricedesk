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
import { Link } from 'react-router-dom'
import { useQuotesQuery } from '../queries/ipc'

const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

export default function QuotesPage(): React.JSX.Element {
  const query = useQuotesQuery()
  return (
    <Stack spacing={3}>
      <Typography variant="h5" component="h1">
        Saved quotes
      </Typography>
      <Button component={Link} to="/quotes/new" variant="contained" sx={{ alignSelf: 'start' }}>
        New quote
      </Button>
      {query.isPending ? (
        <Typography role="status">Loading quotations…</Typography>
      ) : query.isError ? (
        <Alert
          severity="error"
          action={
            <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        >
          Could not load quotations.
        </Alert>
      ) : query.data.length === 0 ? (
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
              {query.data.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell>
                    <Button component={Link} to={`/quotes/${quote.id}`}>
                      View #{quote.id}
                    </Button>
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
    </Stack>
  )
}
