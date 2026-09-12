import type { AppAPI, RuntimeInfo } from './api'

declare global {
  interface Window {
    electron: RuntimeInfo
    api: AppAPI
  }
}
