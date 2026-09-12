import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { AppAPI } from '../preload/api'
import type { createProductRepository } from './database/products'

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
  rendererUrl: string,
  products: ReturnType<typeof createProductRepository>
): void {
  const validateSender = (event: IpcMainInvokeEvent): void => {
    const window = getWindow()
    const frame = event.senderFrame
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      !frame ||
      frame !== window.webContents.mainFrame ||
      frame.url.split('#')[0] !== rendererUrl.split('#')[0]
    ) {
      throw new Error('Untrusted IPC sender')
    }
  }

  ipcMain.handle('app:get-version', (event): Awaited<ReturnType<AppAPI['getAppVersion']>> => {
    validateSender(event)
    return app.getVersion()
  })
  ipcMain.handle('products:get-all', (event): Awaited<ReturnType<AppAPI['getProducts']>> => {
    validateSender(event)
    return products.getProducts()
  })
}
