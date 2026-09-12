export interface AppAPI {
  getAppVersion: () => Promise<string>
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
