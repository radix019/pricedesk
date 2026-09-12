import ProductCatalogue from '../components/ProductCatalogue'
import ProductExcelActions from '../components/ProductExcelActions'

export default function ProductsPage(): React.JSX.Element {
  return (
    <>
      <ProductExcelActions />
      <ProductCatalogue />
    </>
  )
}
