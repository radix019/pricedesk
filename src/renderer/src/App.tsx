import { useState } from 'react'
import Versions from './components/Versions'
import ProductCatalogue from './components/ProductCatalogue'

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
      <ProductCatalogue />
      <div className="actions">
        <div className="action">
          <a href="https://electron-vite.org/" target="_blank" rel="noreferrer">
            Documentation
          </a>
        </div>
        <div className="action">
          <button type="button" onClick={getAppVersion} disabled={loading}>
            {loading ? 'Getting version…' : 'Get app version'}
          </button>
        </div>
      </div>
      <Versions />
      <p role="status">{error ?? (appVersion ? `App version: ${appVersion}` : '')}</p>
    </>
  )
}

export default App
