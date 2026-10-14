import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, Menu, nativeImage, protocol, shell, Tray } from 'electron'
import type { CrateEvent } from '@shared/api'
import type { AppSettings } from '@shared/types'
import { createServices, type Services } from './services'
import { createApi, registerIpc } from './ipc'
import { Reminders } from './reminders'

const MEDIA_SCHEME = 'crate-media'

protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let services: Services | null = null
let reminders: Reminders | null = null

function send(event: CrateEvent): void {
  mainWindow?.webContents.send('crate:event', event)
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Crate',
    backgroundColor: '#0f0d17',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (e) => {
    if (!quitting && services?.settings.get().minimiseToTray && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // Links open in the browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function createTray(): void {
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'tray.png') : path.join(app.getAppPath(), 'build', 'tray.png')
  if (!fs.existsSync(iconPath)) return
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Crate')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Crate', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

function applySystemSettings(s: AppSettings): void {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: s.startWithSystem, args: ['--hidden'] })
  }
}

/** Serves library files to the UI with range support so videos can be scrubbed. */
function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.slice(1))
    if (!services?.library.isKnownPath(filePath) || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 })
    const size = fs.statSync(filePath).size
    const ext = path.extname(filePath).toLowerCase()
    const type =
      { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }[ext] ??
      'application/octet-stream'
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      const stream = fs.createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
      })
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.silkie86.crate')
    services = await createServices(send, applySystemSettings)
    registerMediaProtocol()
    registerIpc(createApi(services, () => mainWindow))
    applySystemSettings(services.settings.get())
    createTray()
    if (!process.argv.includes('--hidden')) createWindow()

    reminders = new Reminders(
      services.planner,
      services.settings,
      services.library,
      (page, id) => {
        showWindow()
        send({ type: 'navigate', payload: { page, id } })
      },
      (card) => send({ type: 'card-detected', payload: card })
    )
    reminders.start()

    app.on('activate', showWindow)
  })

  app.on('before-quit', () => {
    quitting = true
    reminders?.stop()
    services?.db.flush()
  })

  app.on('window-all-closed', () => {
    // With a tray icon the app keeps running for reminders; otherwise quit (except on macOS).
    if (!tray && process.platform !== 'darwin') app.quit()
  })
}
