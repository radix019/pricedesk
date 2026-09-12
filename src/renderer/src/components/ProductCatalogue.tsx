import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material'
import { useProductsQuery } from '../queries/ipc'

const formatPrice = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

export default function ProductCatalogue(): React.JSX.Element {
  const query = useProductsQuery()
  const products = query.data ?? []

  return (
    <Box className="catalogue" aria-labelledby="catalogue-title" aria-busy={query.isFetching}>
      <Typography variant="h1" id="catalogue-title">
        PriceDesk product catalogue
      </Typography>
      {query.isPending ? (
        <Typography role="status">Loading products…</Typography>
      ) : query.isError ? (
        <div className="action">
          <p role="alert">Could not load products. Please try again.</p>
          <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      ) : products.length === 0 ? (
        <Typography role="status">No products yet.</Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Quote items">
            <caption>Prices in Indian rupees</caption>
            <TableHead>
              <TableRow>
                <TableCell scope="col">
                  <Typography> SKU</Typography>
                </TableCell>
                <TableCell scope="col">
                  <Typography>Name</Typography>
                </TableCell>
                <TableCell scope="col" className="price">
                  <Typography>Price</Typography>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Typography>{product.sku}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography>{product.name}</Typography>
                  </TableCell>
                  <TableCell className="price">
                    <Typography>{formatPrice.format(product.pricePaise / 100)}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
