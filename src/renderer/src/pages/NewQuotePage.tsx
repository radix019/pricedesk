import { Alert, Button, Stack, Typography } from '@mui/material'
import { Link, useNavigate } from 'react-router-dom'
import { useProductsQuery } from '../queries/ipc'
import QuoteForm from '../components/QuoteForm'

export default function NewQuotePage(): React.JSX.Element {
  const query = useProductsQuery()
  const navigate = useNavigate()
  return (
    <Stack spacing={2}>
      <Button component={Link} to="/quotes" sx={{ alignSelf: 'start' }}>
        Back to quotes
      </Button>
      {query.isPending ? (
        <Typography role="status">Loading products…</Typography>
      ) : query.isError ? (
        <Alert
          severity="error"
          action={
            <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        >
          Could not load products.
        </Alert>
      ) : (
        <QuoteForm
          products={query.data}
          onSaved={(quote) => {
            void navigate(`/quotes/${quote.id}`, {
              replace: true,
              state: { savedQuoteId: quote.id }
            })
          }}
        />
      )}
    </Stack>
  )
}
