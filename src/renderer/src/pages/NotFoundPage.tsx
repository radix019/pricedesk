import { Button, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'

export default function NotFoundPage(): React.JSX.Element {
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Page not found
      </Typography>
      <Typography>The requested page does not exist.</Typography>
      <Button component={Link} to="/products" sx={{ alignSelf: 'start' }}>
        Back to products
      </Button>
    </Stack>
  )
}
