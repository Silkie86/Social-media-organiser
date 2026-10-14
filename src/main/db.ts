// Local database. Uses sql.js (SQLite compiled to WebAssembly) so there is nothing native
// to compile on Windows, macOS or Linux. The whole database lives in memory and is written
// to disk shortly after every change.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'

const require = createRequire(import.meta.url)

// Each entry upgrades the schema by one version. Never edit an old entry; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE shoots (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    folder TEXT NOT NULL
  );
  CREATE TABLE assets (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    duration_sec REAL,
    width INTEGER,
    height INTEGER,
    fps REAL,
    codec TEXT,
    camera TEXT,
    is_log INTEGER NOT NULL DEFAULT 0,
    shoot_id INTEGER REFERENCES shoots(id) ON DELETE SET NULL,
    rating INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT NOT NULL DEFAULT '',
    thumb_path TEXT,
    paired_raw_path TEXT,
    source_key TEXT NOT NULL UNIQUE
  );
  CREATE INDEX idx_assets_captured ON assets(captured_at);
  CREATE TABLE asset_tags (
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (asset_id, tag)
  );
  CREATE TABLE exports (
    id INTEGER PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    preset_id TEXT NOT NULL,
    path TEXT,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    error TEXT,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '[]',
    targets TEXT NOT NULL DEFAULT '[]',
    scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    posted_at TEXT,
    reminded_at TEXT,
    pillar TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE post_assets (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, asset_id)
  );
  CREATE TABLE ideas (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT '',
    pillar TEXT NOT NULL DEFAULT '',
    hook TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    source TEXT NOT NULL DEFAULT 'ai',
    created_at TEXT NOT NULL
  );
  CREATE TABLE hashtag_sets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE accounts (
    platform TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    connected_at TEXT NOT NULL
  );
  CREATE TABLE platform_media (
    platform TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (platform, id)
  );
  `
]

export type Row = Record<string, SqlValue>
type Params = SqlValue[] | Record<string, SqlValue>

export class Db {
  private saveTimer: NodeJS.Timeout | null = null

  private constructor(
    private readonly db: Database,
    private readonly file: string
  ) {}

  static async open(file: string): Promise<Db> {
    const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    const SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer })
    const data = fs.existsSync(file) ? fs.readFileSync(file) : undefined
    const instance = new Db(new SQL.Database(data), file)
    instance.db.run('PRAGMA foreign_keys = ON')
    instance.migrate()
    return instance
  }

  private migrate(): void {
    const current = Number(this.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0)
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v])
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    }
    if (current < MIGRATIONS.length) this.flush()
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  /** Runs a write and returns the new row id. */
  run(sql: string, params: Params = []): number {
    this.db.run(sql, params)
    const id = Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0)
    this.scheduleSave()
    return id
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      this.scheduleSave()
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 500)
  }

  /** Writes the database to disk atomically (temp file, then rename). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, Buffer.from(this.db.export()))
    fs.renameSync(tmp, this.file)
    // sql.js reopens the database inside export(), which resets connection settings.
    this.db.run('PRAGMA foreign_keys = ON')
  }
}

export function json<T>(value: SqlValue, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
