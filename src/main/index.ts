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
// One main process owns the local outbox.
const ownsInstanceLock = app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()
const rendererUrl =
  is.dev && process.env['ELECTRON_RENDERER_URL']
    ? new URL(process.env['ELECTRON_RENDERER_URL']).href
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href

function createWindow(): void {
  // Create the browser window.
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

  // Use the same URL for loading and IPC sender validation.
  window.loadURL(rendererUrl)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  if (!ownsInstanceLock) return
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    database = openDatabase(app.getPath('userData'))
    sync = createSyncService(database, createTransport(process.env.PRICEDESK_API_PORT))
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
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
