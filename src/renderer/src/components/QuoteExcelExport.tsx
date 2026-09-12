import { Alert, Button, Stack } from '@mui/material'
import { useMutation } from '@tanstack/react-query'

export default function QuoteExcelExport({ quoteId }: { quoteId: number }): React.JSX.Element {
  const exportQuote = useMutation({
    mutationFn: () => window.api.exportQuoteExcel(quoteId),
    networkMode: 'always',
    retry: false
  })
  return (
    <Stack spacing={1} sx={{ alignItems: 'start' }}>
      <Button
        variant="outlined"
        disabled={exportQuote.isPending}
        onClick={() => exportQuote.mutate()}
      >
        {exportQuote.isPending ? 'Exporting…' : 'Export Excel'}
      </Button>
      {exportQuote.isError && <Alert severity="error">{exportQuote.error.message}</Alert>}
      {exportQuote.isSuccess && !exportQuote.data.canceled && (
        <Alert severity="success">Quote exported to Excel.</Alert>
      )}
    </Stack>
  )
}
