import type { CrateApi, CrateEvent } from '../shared/api'

declare global {
  interface Window {
    crate: CrateApi
    crateEvents: { on(listener: (event: CrateEvent) => void): () => void }
  }
}
