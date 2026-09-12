import { useRef } from 'react'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { getIn, useFormik } from 'formik'
import * as Yup from 'yup'
import type { Product, Quote } from '../../../preload/api'
import { calculateTotals, rupeesToPaise } from '../../../shared/money'
import { useCreateQuoteMutation } from '../queries/ipc'

const format = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
const initialValues = {
  customerName: '',
  items: [{ productId: '', quantity: '1' }],
  discount: '0'
}

export default function QuoteForm({
  products,
  onSaved
}: {
  products: Product[]
  onSaved: (quote: Quote) => void
}): React.JSX.Element {
  const pending = useRef(false)
  const mutation = useCreateQuoteMutation()
  const schema = Yup.object({
    customerName: Yup.string().trim().required('Enter a customer name').max(200),
    items: Yup.array()
      .of(
        Yup.object({
          productId: Yup.string()
            .required('Choose a product')
            .test('exists', 'Choose a current product', (value) =>
              products.some((product) => String(product.id) === value)
            ),
          quantity: Yup.string()
            .required('Enter a quantity')
            .matches(/^[1-9]\d*$/, 'Use a positive whole number')
            .test('safe', 'Quantity is too large', (value) => Number.isSafeInteger(Number(value)))
        })
      )
      .min(1, 'Add at least one product')
      .max(100)
      .test('unique', 'Each product can appear only once', (rows) => {
        const ids = rows?.map((row) => row.productId).filter(Boolean) ?? []
        return new Set(ids).size === ids.length
      }),
    discount: Yup.string()
      .required('Enter a discount, or 0')
      .test(
        'currency',
        'Use a non-negative rupee amount with at most two decimal places',
        (value) => {
          try {
            rupeesToPaise(value ?? '')
            return true
          } catch {
            return false
          }
        }
      )
      .test(
        'total',
        'Discount cannot exceed subtotal; totals must be within the supported range',
        function (value) {
          try {
            rupeesToPaise(value ?? '')
          } catch {
            return true
          }
          const rows = (this.parent as typeof initialValues).items
          if (
            rows.some(
              (row) =>
                !products.some((product) => String(product.id) === row.productId) ||
                !/^[1-9]\d*$/.test(row.quantity)
            )
          )
            return true
          try {
            calculateTotals(
              rows.map((row) => ({
                unitPricePaise: products.find((product) => String(product.id) === row.productId)!
                  .pricePaise,
                quantity: Number(row.quantity)
              })),
              rupeesToPaise(value!)
            )
            return true
          } catch {
            return false
          }
        }
      )
  })
  const form = useFormik({
    initialValues,
    validationSchema: schema,
    onSubmit: async (values, helpers) => {
      if (pending.current) return
      pending.current = true
      mutation.reset()
      try {
        const quote = await mutation.mutateAsync({
          customerName: values.customerName.trim(),
          items: values.items.map((row) => ({
            productId: Number(row.productId),
            quantity: Number(row.quantity)
          })),
          discountPaise: rupeesToPaise(values.discount)
        })
        helpers.resetForm()
        onSaved(quote)
      } catch {
        // Mutation state supplies the error; keep the Formik draft for correction or retry.
      } finally {
        pending.current = false
      }
    }
  })
  const field = (name: string): { error: boolean; helperText?: string } => {
    const message = getIn(form.errors, name)
    const show = getIn(form.touched, name) || form.submitCount > 0
    return {
      error: Boolean(show && typeof message === 'string'),
      helperText: show && typeof message === 'string' ? message : undefined
    }
  }
  let preview: ReturnType<typeof calculateTotals> | undefined
  try {
    preview = calculateTotals(
      form.values.items.map((row) => {
        const product = products.find((product) => String(product.id) === row.productId)
        if (!product) throw new Error('Choose a product')
        return { unitPricePaise: product.pricePaise, quantity: Number(row.quantity) }
      }),
      rupeesToPaise(form.values.discount)
    )
  } catch {
    /* Incomplete or invalid fields have no calculated preview. */
  }

  return (
    <Box component="form" onSubmit={form.handleSubmit} noValidate>
      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          New quotation
        </Typography>
        {mutation.isError && (
          <Alert severity="error">
            {mutation.error.message.replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              ''
            )}
          </Alert>
        )}
        {products.length === 0 && (
          <Alert severity="info">Add catalogue products before creating a quote.</Alert>
        )}
        <Box
          component="fieldset"
          disabled={form.isSubmitting}
          sx={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Stack spacing={4}>
            <TextField
              label="Customer name"
              {...form.getFieldProps('customerName')}
              {...field('customerName')}
            />
            {form.values.items.map((_, index) => (
              <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={7}>
                <TextField
                  select
                  label={`Product ${index + 1}`}
                  sx={{ flex: 2 }}
                  {...form.getFieldProps(`items.${index}.productId`)}
                  {...field(`items.${index}.productId`)}
                >
                  {products.map((product) => (
                    <MenuItem key={product.id} value={String(product.id)}>
                      {product.sku} — {product.name} ({format.format(product.pricePaise / 100)})
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label={`Quantity ${index + 1}`}
                  sx={{ flex: 1 }}
                  {...form.getFieldProps(`items.${index}.quantity`)}
                  {...field(`items.${index}.quantity`)}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                />
                <Button
                  type="button"
                  variant="outlined"
                  color="warning"
                  disabled={form.isSubmitting || form.values.items.length === 1}
                  onClick={() =>
                    form.setFieldValue(
                      'items',
                      form.values.items.filter((_, i) => i !== index)
                    )
                  }
                >
                  Remove
                </Button>
              </Stack>
            ))}
            {typeof form.errors.items === 'string' && (
              <Alert severity="error">{form.errors.items}</Alert>
            )}
            <Button
              type="button"
              color="success"
              sx={{ fontSize: '1.5rem' }}
              disabled={form.isSubmitting || form.values.items.length >= 100}
              onClick={() =>
                form.setFieldValue('items', [
                  ...form.values.items,
                  { productId: '', quantity: '1' }
                ])
              }
            >
              + Add Product
            </Button>
            <TextField
              label="Fixed discount (₹)"
              {...form.getFieldProps('discount')}
              {...field('discount')}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          </Stack>
        </Box>
        <Typography aria-live="polite">
          Subtotal: {preview ? format.format(preview.subtotalPaise / 100) : '—'} · Total:{' '}
          {preview ? format.format(preview.totalPaise / 100) : '—'}
        </Typography>
        <Typography variant="body2">
          The saved quote uses current catalogue prices at the time of saving.
        </Typography>
        <Button
          type="submit"
          variant="contained"
          sx={{ width: '20%' }}
          disabled={form.isSubmitting || products.length === 0}
        >
          {form.isSubmitting ? 'Saving quote…' : 'Save quote'}
        </Button>
      </Stack>
    </Box>
  )
}
