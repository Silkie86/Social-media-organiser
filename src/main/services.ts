// Builds and wires together every service the app uses.

import path from 'node:path'
import { app } from 'electron'
import type { AppSettings } from '@shared/types'
import type { CrateEvent } from '@shared/api'
import { Db } from './db'
import { Settings } from './settings'
import { Library } from './library/library'
import { Exporter } from './export/exporter'
import { Planner } from './planner'
import { ContentAI } from './ai/claude'

export interface Services {
  db: Db
  settings: Settings
  library: Library
  exporter: Exporter
  planner: Planner
  ai: ContentAI
  onSettingsChanged: (s: AppSettings) => void
}

export async function createServices(send: (event: CrateEvent) => void, onSettingsChanged: (s: AppSettings) => void): Promise<Services> {
  const dataDir = app.getPath('userData')
  const db = await Db.open(path.join(dataDir, 'crate.db'))
  const settings = new Settings(db)
  const library = new Library(
    db,
    path.join(dataDir, 'thumbnails'),
    () => settings.get().libraryRoot,
    (payload) => send({ type: 'import-progress', payload }),
    () => send({ type: 'library-changed', payload: null })
  )
  const exporter = new Exporter(
    db,
    (id) => library.get(id),
    () => settings.get().libraryRoot,
    () => settings.get().lutPath,
    (payload) => send({ type: 'export-progress', payload })
  )
  const planner = new Planner(db)
  const ai = new ContentAI(() => settings.getSecret('claude'))
  return { db, settings, library, exporter, planner, ai, onSettingsChanged }
}
