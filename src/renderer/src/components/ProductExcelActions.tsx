import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material'
import type { ProductImportPreview } from '../../../shared/excel'

export default function ProductExcelActions(): React.JSX.Element {
  const client = useQueryClient()
  const [preview, setPreview] = useState<ProductImportPreview | null>(null)
  const [message, setMessage] = useState('')
  const options = { networkMode: 'always', retry: false } as const
  const template = useMutation({
    ...options,
    mutationFn: () => window.api.exportProductTemplate(),
    onMutate: () => setMessage(''),
    onSuccess: (result) => {
      if (!result.canceled) setMessage('Product template exported.')
    }
  })
  const commit = useMutation({
    ...options,
    mutationFn: (token: string) => window.api.confirmProductImport(token),
    onSuccess: async (result) => {
      setPreview(null)
      setMessage(`${result.importedCount} products imported.`)
      await client.invalidateQueries({ queryKey: ['products'] })
    }
  })
  const load = useMutation({
    ...options,
    mutationFn: () => window.api.previewProductImport(),
    onMutate: () => {
      setPreview(null)
      setMessage('')
      commit.reset()
      template.reset()
    },
    onSuccess: (result) => {
      if (result.canceled === false) setPreview(result)
    }
  })
  const busy = template.isPending || load.isPending || commit.isPending
  return (
    <Stack spacing={2} sx={{ mb: 3 }}>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() => {
            load.reset()
            template.mutate()
          }}
        >
          Export Product Template
        </Button>
        <Button variant="contained" disabled={busy} onClick={() => load.mutate()}>
          {load.isPending ? 'Reading workbook…' : 'Import Products'}
        </Button>
      </Stack>
      <Typography variant="body2">
        Import .xlsx files up to 5 MB with at most 1,000 products. Review all rows before saving.
      </Typography>
      {(load.isError || template.isError) && (
        <Alert severity="error">{load.error?.message ?? template.error?.message}</Alert>
      )}
      {message && <Alert severity="success">{message}</Alert>}
      <Dialog
        open={preview !== null}
        onClose={() => {
          if (!commit.isPending) setPreview(null)
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>Review product import</DialogTitle>
        <DialogContent>
          {preview && (
            <Stack spacing={2}>
              <Typography>
                {preview.rows.length} rows. Matching SKUs will be updated; new SKUs will be added.
                All rows must be valid to import.
              </Typography>
              {preview.expiresAt && (
                <Typography variant="body2">
                  Confirm before {new Date(preview.expiresAt).toLocaleTimeString()}; otherwise
                  select the file again.
                </Typography>
              )}
              {preview.errors.map((error, index) => (
                <Alert key={index} severity="error">
                  {error}
                </Alert>
              ))}
              {preview.rows.some((row) => row.errors.length) && (
                <Alert severity="error">
                  Fix the errors in your workbook, then select the file again. No products have been
                  changed.
                </Alert>
              )}
              {commit.isError && <Alert severity="error">{commit.error.message}</Alert>}
              <TableContainer sx={{ maxHeight: 420 }}>
                <Table size="small" stickyHeader aria-label="Product import preview">
                  <TableHead>
                    <TableRow>
                      {['Excel row', 'SKU', 'Name', 'PriceINR', 'Validation'].map((header) => (
                        <TableCell key={header}>{header}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>{row.sku}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{row.priceINR}</TableCell>
                        <TableCell
                          sx={{ color: row.errors.length ? 'error.main' : 'text.secondary' }}
                        >
                          {row.errors.join(' ') || 'Valid'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={commit.isPending} onClick={() => setPreview(null)}>
            Cancel
          </Button>
          <Button disabled={commit.isPending} onClick={() => load.mutate()}>
            Select File Again
          </Button>
          <Button
            variant="contained"
            disabled={!preview?.token || busy || commit.isError}
            onClick={() => {
              if (preview?.token) commit.mutate(preview.token)
            }}
          >
            {commit.isPending ? 'Importing…' : 'Confirm Import'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
