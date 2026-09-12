export interface Product {
  id: number
  sku: string
  name: string
  pricePaise: number
}

export interface AppAPI {
  getAppVersion: () => Promise<string>
  getProducts: () => Promise<Product[]>
}

export interface RuntimeInfo {
  process: {
    versions: {
      electron: string
      chrome: string
      node: string
    }
  }
}
