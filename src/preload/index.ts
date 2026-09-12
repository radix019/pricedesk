import { contextBridge, ipcRenderer } from 'electron'
import type { AppAPI, RuntimeInfo } from './api'

const api: AppAPI = {
  getAppVersion: async () => {
    const version: unknown = await ipcRenderer.invoke('app:get-version')
    if (typeof version !== 'string') throw new Error('Invalid app version response')
    return version
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
