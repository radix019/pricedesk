import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createTheme, ThemeProvider } from '@mui/material/styles'

const theme = createTheme({
  palette: { mode: 'dark' },
  typography: { fontFamily: 'system-ui, sans-serif', fontSize: 20 }
})
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  </StrictMode>
)
