import { contextBridge, ipcRenderer } from 'electron'
import type { AppAPI, Product, RuntimeInfo } from './api'

function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) return false
  const product = value as Record<string, unknown>
  return (
    Number.isSafeInteger(product.id) &&
    typeof product.sku === 'string' &&
    typeof product.name === 'string' &&
    typeof product.pricePaise === 'number' &&
    Number.isSafeInteger(product.pricePaise) &&
    product.pricePaise >= 0
  )
}

const api: AppAPI = {
  getAppVersion: async () => {
    const version: unknown = await ipcRenderer.invoke('app:get-version')
    if (typeof version !== 'string') throw new Error('Invalid app version response')
    return version
  },
  getProducts: async () => {
    const products: unknown = await ipcRenderer.invoke('products:get-all')
    if (!Array.isArray(products) || !products.every(isProduct)) {
      throw new Error('Invalid products response')
    }
    return products
  }
}

// Keep the starter's version display without exposing generic Electron APIs.
const runtimeInfo: RuntimeInfo = {
  process: {
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('electron', runtimeInfo)
