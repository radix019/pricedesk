import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import NavigationLayout from './components/NavigationLayout'

const ProductsPage = lazy(() => import('./pages/ProductsPage'))
const QuotesPage = lazy(() => import('./pages/QuotesPage'))
const NewQuotePage = lazy(() => import('./pages/NewQuotePage'))
const QuoteDetailPage = lazy(() => import('./pages/QuoteDetailPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export default function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<NavigationLayout />}>
        <Route index element={<Navigate to="/products" replace />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="quotes/new" element={<NewQuotePage />} />
        <Route path="quotes/:id" element={<QuoteDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
