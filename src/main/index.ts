import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './database'
import { createProductRepository } from './database/products'
import { createQuoteRepository } from './database/quotes'
import { registerIpcHandlers } from './ipc'
import { createSyncService, createTransport } from './sync'

let mainWindow: BrowserWindow | null = null
let database: ReturnType<typeof openDatabase> | undefined
let sync: ReturnType<typeof createSyncService> | undefined
let shuttingDown = false

const ownsInstanceLock = app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()
const rendererUrl =
  is.dev && process.env['ELECTRON_RENDERER_URL']
    ? new URL(process.env['ELECTRON_RENDERER_URL']).href
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href

function createWindow(): void {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  window.loadURL(rendererUrl)
}
app.whenReady().then(() => {
  if (!ownsInstanceLock) return
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    database = openDatabase(app.getPath('userData'))
    sync = createSyncService(database, createTransport(process.env.PRICEDESK_API_URL))
    registerIpcHandlers(
      () => mainWindow,
      rendererUrl,
      createProductRepository(database),
      createQuoteRepository(database),
      sync
    )
    sync.start()
  } catch (error) {
    console.error('Failed to initialize PriceDesk', error)
    dialog.showErrorBox(
      'PriceDesk could not start',
      'Could not open the product catalogue database.'
    )
    app.quit()
    return
  }

  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (shuttingDown || !sync) return
  event.preventDefault()
  shuttingDown = true
  void sync
    .stop()
    .catch((error) => console.error('Sync shutdown failed', error))
    .finally(() => {
      database?.close()
      app.quit()
    })
})
