import { useState } from 'react'
import { Box, GlobalStyles } from '@mui/material'
import Versions from './components/Versions'
import ProductCatalogue from './components/ProductCatalogue'
import Quotations from './components/Quotations'

function App(): React.JSX.Element {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getAppVersion = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setAppVersion(await window.api.getAppVersion())
    } catch {
      setError('Could not get the app version. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <GlobalStyles
        styles={{
          body: { display: 'block' },
          '#root': { display: 'block', width: '100%', marginBottom: 0 }
        }}
      />
      <Box
        component="main"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
          gap: { xs: 2, lg: 3 },
          p: { xs: 2, lg: 3 },
          alignItems: 'start',
          '@media (max-width: 799px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
          '& > .workspace-panel': {
            minWidth: 0,
            p: { xs: 2, lg: 3 },
            border: '1px solid rgba(150, 165, 185, 0.18)',
            borderRadius: 3,
            backgroundColor: 'var(--color-background)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)'
          }
        }}
      >
        <Box
          className="workspace-panel"
          sx={{
            '& .catalogue': { width: '100%', paddingTop: 0, fontSize: 14 },
            '& .catalogue h1': { fontSize: { xs: 20, lg: 24 }, lineHeight: 1.3 },
            '& .catalogue th, & .catalogue td': { px: 1, py: 1.5 }
          }}
        >
          <ProductCatalogue />
        </Box>
        <Box
          className="workspace-panel"
          sx={{ '& > section': { width: '100%', minWidth: 0, marginTop: 0 } }}
        >
          <Quotations />
          <Box
            component="footer"
            sx={{
              mt: 3,
              pt: 2,
              borderTop: '1px solid rgba(150, 165, 185, 0.18)',
              fontSize: 14,
              '& .actions': { paddingTop: 0 },
              '& .versions': { display: 'flex', flexWrap: 'wrap', gap: 1, borderRadius: 2 },
              '& .versions li': { padding: '0 10px', fontSize: 12, lineHeight: 1.5 }
            }}
          >
            <div className="actions">
              <div className="action">
                <button type="button" onClick={getAppVersion} disabled={loading}>
                  {loading ? 'Getting version…' : 'Get app version'}
                </button>
              </div>
            </div>
            <p role="status">{error ?? (appVersion ? `App version: ${appVersion}` : '')}</p>
            <Versions />
          </Box>
        </Box>
      </Box>
    </>
  )
}

export default App
