import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import { queryClient } from './queries/client'

const theme = createTheme({
  palette: { mode: 'light' },
  typography: { fontFamily: 'system-ui, sans-serif', fontSize: 20 }
})
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
