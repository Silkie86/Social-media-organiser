# How Crate is put together

Crate is an [Electron](https://www.electronjs.org/) desktop app written in TypeScript, with a
React UI. One codebase builds for Windows, macOS and Linux.

```
src/
  shared/        Types and data used on both sides
    types.ts       Domain model: Asset, Post, Idea, settings…
    formats.ts     Platform export presets + the "is this ready to upload?" check
    api.ts         The UI ⇄ app contract (every method the UI can call)
  main/          The app process (Node.js): files, database, ffmpeg, network
    index.ts       Window, tray, media protocol, start-up
    ipc.ts         Implements api.ts by calling the services below
    services.ts    Builds and wires the services
    db.ts          SQLite via sql.js (WebAssembly, nothing native to compile) + migrations
    settings.ts    Settings + encrypted secrets (OS keychain via safeStorage)
    library/       Importing, camera cards (Sony layout + XML metadata), tagging
    export/        ffmpeg wrapper and the export queue
    planner.ts     Posts, ideas, hashtag sets, dashboard, best times
    reminders.ts   Notifications: post reminders, daily nudge, card detection
    ai/claude.ts   Ideas and captions through the Claude API
    platforms/     One adapter per social network (Instagram now; others stubbed)
  preload/       Exposes api.ts to the UI safely (contextIsolation on)
  renderer/      The React UI (pages/ and components/)
test/            Unit tests and an end-to-end test using the real ffmpeg
```

## Extending it

**Add a platform (TikTok, YouTube, SoundCloud…)**
1. Create `src/main/platforms/<name>.ts` implementing `PlatformAdapter` from `types.ts`
   (`connect`, and optionally `refresh`, `recentMedia`, `publish`).
2. Replace its `comingSoon(...)` entry in `platforms/registry.ts`.
The Accounts page, token storage and best-times analysis pick it up automatically.

**Add or change an export format**: add an entry to `PRESETS` in `src/shared/formats.ts`.
The readiness check, export queue, planner targets and Library panel all read from that list.

**Add a feature the UI can call**: add the method to `CrateApi` in `src/shared/api.ts` (the
build fails until it's also in `METHOD_MAP`), implement it in `src/main/ipc.ts`, then call
`api.yourMethod()` from the UI.

**Change the database**: append a new SQL string to `MIGRATIONS` in `src/main/db.ts`. Never
edit an existing one; users' databases are upgraded step by step.

**Support another camera**: `src/main/library/camera.ts` knows card layouts and metadata files.
Add the folder layout to `detectCardLayout` and a metadata reader like `readSonyMeta`.

## Data on disk

- Library (your footage + exports): the folder chosen in Settings, by default `Videos/Crate Library`.
  Imports go into `YYYY/YYYY-MM-DD Shoot name/{Video,Photos,RAW,Audio}`, exports into `Ready to Post/`.
- App data (database, thumbnails, encrypted keys): Electron's user-data folder, on Windows
  `%APPDATA%\Crate`.

## Commands

```
npm install        # once
npm run dev        # run with live reload
npm test           # unit + end-to-end tests
npm run typecheck
npm run dist:win   # build the Windows installer into release/
```
