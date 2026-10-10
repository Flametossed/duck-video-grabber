const { app, BrowserWindow, Menu, nativeTheme, ipcMain, dialog, shell, clipboard } = require('electron')
const { spawn, execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { createCookies, BROWSERS, needsAuth } = require('./cookies')
const { createUpdater, looksBroken } = require('./updater')

// The portable build keeps its settings and downloaded tools next to the exe, not in AppData.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Duck Video Grabber Data'))
}

const MAX_CONCURRENT = 2
const SURFACE = '#17191c'

// ---------------------------------------------------------------- settings

const defaults = () => ({
  downloadDir: app.getPath('downloads'),
  theme: 'default',
  subLanguage: 'system', // preferred subtitle language: 'system' or a code such as 'es' or 'zh-Hant'
  ytdlpPath: '',
  ffmpegPath: '',
  cookieMode: 'auto', // auto | browser | file | off
  cookieBrowser: 'firefox',
  cookieFile: '',
  lastCookieBrowser: '',
  autoUpdateTools: true, // keep yt-dlp and ffmpeg current
  toolsCheckedAt: 0
})

let settings = null
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function loadSettings () {
  try {
    settings = { ...defaults(), ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
    delete settings.uiScale // removed: Windows display scaling is used instead
  } catch {
    settings = defaults()
  }
}

function saveSettings (patch) {
  const next = { ...settings }
  if (typeof patch.downloadDir === 'string' && patch.downloadDir) next.downloadDir = patch.downloadDir
  if (['default', 'amoled'].includes(patch.theme)) next.theme = patch.theme
  if (patch.subLanguage === 'system' || /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(patch.subLanguage || '')) next.subLanguage = patch.subLanguage
  if (typeof patch.ytdlpPath === 'string') next.ytdlpPath = patch.ytdlpPath
  if (typeof patch.ffmpegPath === 'string') next.ffmpegPath = patch.ffmpegPath
  if (['auto', 'browser', 'file', 'off'].includes(patch.cookieMode)) next.cookieMode = patch.cookieMode
  if (BROWSERS[patch.cookieBrowser]) next.cookieBrowser = patch.cookieBrowser
  if (typeof patch.cookieFile === 'string') next.cookieFile = patch.cookieFile
  if (patch.lastCookieBrowser === '' || BROWSERS[patch.lastCookieBrowser]) next.lastCookieBrowser = patch.lastCookieBrowser
  if (typeof patch.autoUpdateTools === 'boolean') next.autoUpdateTools = patch.autoUpdateTools
  if (typeof patch.toolsCheckedAt === 'number') next.toolsCheckedAt = patch.toolsCheckedAt
  settings = next
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
  return settings
}

// ---------------------------------------------------------------- binaries

const updater = createUpdater({
  app,
  getSettings: () => settings,
  saveSettings: patch => saveSettings(patch),
  send: (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload) }
})

const ytdlp = () => updater.resolve('yt-dlp').bin

const cookies = createCookies({ app, getSettings: () => settings, saveSettings: patch => saveSettings(patch), ytdlp })

function ffmpegArgs () {
  const { bin } = updater.resolve('ffmpeg')
  return bin === 'ffmpeg' ? [] : ['--ffmpeg-location', path.dirname(bin)]
}

// Self-healing: when yt-dlp fails in a way that usually means a site changed, update yt-dlp
// (and Deno) once and retry. Limited to once an hour, and only when auto update is on.
const HEAL_EVERY_MS = 60 * 60 * 1000
let lastHeal = 0
const canHeal = text => settings.autoUpdateTools && looksBroken(text) && Date.now() - lastHeal > HEAL_EVERY_MS

// Resolves true if something was updated, so the caller should retry.
async function healTools () {
  lastHeal = Date.now()
  const out = await updater.update({ only: ['ytdlp', 'deno'], notify: true })
  return out.results.some(r => r.status === 'updated')
}

function friendlyError (err) {
  if (err.code === 'ENOENT') return 'yt-dlp was not found. Install it or set its path in Settings.'
  const lines = String(err.stderr || err.message || err).split(/\r?\n/).filter(l => /ERROR/.test(l))
  const last = lines[lines.length - 1] || String(err.message || err)
  return last.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim().slice(0, 300)
}

function validateUrl (value) {
  let u
  try { u = new URL(String(value).trim()) } catch { throw new Error('That does not look like a link.') }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https links are supported.')
  return u.toString()
}

// ---------------------------------------------------------------- video info

// Remembers which cookies worked for a link, so the download that follows uses the same ones.
const cookieByUrl = new Map()

// Resolves { ok: true, info } or { ok: false, error, needsAuth, cookieIssue } so the page
// can offer a link to the cookie settings instead of just a toast.
async function fetchInfo (rawUrl) {
  let url
  try { url = validateUrl(rawUrl) } catch (err) { return { ok: false, error: err.message } }

  const build = cookieArgs => ['-J', '--no-playlist', '--no-warnings', '--no-update', ...updater.jsRuntimeArgs(), ...cookieArgs, '--', url]
  let outcome = await cookies.request(build)
  if (!outcome.ok && canHeal(outcome.first ? outcome.first.stderr : '') && await healTools()) {
    outcome = await cookies.request(build)
  }

  if (!outcome.ok) {
    const failed = outcome.first || outcome.result
    const error = failed && failed.spawnError
      ? friendlyError({ code: 'ENOENT' })
      : friendlyError({ stderr: failed ? failed.stderr : '' }) || 'Could not read that link.'
    return {
      ok: false,
      error: outcome.cookieIssue && !outcome.needsAuth ? outcome.cookieIssue.message : error,
      needsAuth: outcome.needsAuth,
      cookieIssue: outcome.cookieIssue ? outcome.cookieIssue.message : ''
    }
  }

  let info
  try { info = JSON.parse(outcome.result.stdout) } catch { return { ok: false, error: 'yt-dlp returned something unexpected.' } }
  if (outcome.spec) {
    if (cookieByUrl.size > 50) cookieByUrl.delete(cookieByUrl.keys().next().value)
    cookieByUrl.set(url, outcome.spec)
  } else {
    cookieByUrl.delete(url)
  }
  const heights = (info.formats || []).map(f => f.height).filter(Boolean)
  return {
    ok: true,
    info: {
      url,
      title: info.title || 'Untitled',
      uploader: info.uploader || info.channel || '',
      duration: info.duration || 0,
      thumbnail: /^https:/.test(info.thumbnail || '') ? info.thumbnail : '',
      site: info.extractor_key || info.extractor || '',
      maxHeight: heights.length ? Math.max(...heights) : 0,
      usedCookies: outcome.spec ? (outcome.spec.browser ? cookies.label(outcome.spec.browser) : 'saved cookies') : '',
      subtitles: pickSubtitles(info),
      subtitleLanguage: preferredSubLanguage()
    }
  }
}

// ---------------------------------------------------------------- download jobs

const PRESETS = {
  best: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4'],
  1080: ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4'],
  720: ['-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*[height<=720]+ba/b', '--merge-output-format', 'mp4'],
  480: ['-f', 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480]/bv*[height<=480]+ba/b', '--merge-output-format', 'mp4'],
  audio: ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
}

// ---------------------------------------------------------------- subtitles

// Codes sites use for the same language. Chinese is split by script; for these, only exact codes count.
const SUB_ALIASES = {
  he: ['he', 'iw'],
  id: ['id', 'in'],
  nb: ['nb', 'no'],
  fil: ['fil', 'tl'],
  'zh-Hans': ['zh-Hans', 'zh-CN', 'zh-SG', 'zh'],
  'zh-Hant': ['zh-Hant', 'zh-TW', 'zh-HK']
}

// Windows' display language, as one of the codes the Settings list uses.
function systemSubLanguage () {
  const [base = 'en', region = ''] = String(app.getLocale() || 'en').split('-')
  const lang = base.toLowerCase()
  if (lang === 'zh') return /^(TW|HK|MO)$/i.test(region) ? 'zh-Hant' : 'zh-Hans'
  return { iw: 'he', in: 'id', no: 'nb', tl: 'fil' }[lang] || lang
}

function preferredSubLanguage () {
  return settings.subLanguage && settings.subLanguage !== 'system' ? settings.subLanguage : systemSubLanguage()
}

// The preferred language, then English as the fallback.
function wantedSubLanguages () {
  return [...new Set([preferredSubLanguage(), 'en'])]
}

// One exact track code per wanted language, preferring human-made subtitles over automatic ones.
// Exact codes matter: YouTube also lists machine translations (such as "en-de"), and yt-dlp's
// --sub-langs patterns match case-insensitively, so a pattern like "en.*" pulls those in too.
function pickSubtitles (info) {
  const manual = Object.keys(info.subtitles || {}).filter(k => k !== 'live_chat')
  const auto = Object.keys(info.automatic_captions || {})
  const pick = (keys, lang) => {
    for (const candidate of SUB_ALIASES[lang] || [lang]) {
      if (keys.includes(candidate)) return candidate
    }
    if (SUB_ALIASES[lang]) return undefined
    return keys.find(k => k.startsWith(lang + '-') && /^[A-Z0-9]/.test(k.slice(lang.length + 1))) // en-US, es-419
  }
  // One track: the preferred language, or English when the video doesn't have it.
  const preferred = preferredSubLanguage()
  for (const lang of wantedSubLanguages()) {
    const code = pick(manual, lang) || pick(auto, lang)
    if (code) return [{ code, lang, auto: !manual.includes(code), fallback: lang !== preferred }]
  }
  return []
}

const SUB_CODE = /^[A-Za-z0-9-]{1,24}$/

// The .srt files saved next to a finished video ("Title [id].en.srt").
function countSubtitleFiles (videoPath) {
  if (!videoPath) return 0
  const base = path.basename(videoPath, path.extname(videoPath)) + '.'
  try {
    return fs.readdirSync(path.dirname(videoPath)).filter(f => f.startsWith(base) && f.toLowerCase().endsWith('.srt')).length
  } catch {
    return 0
  }
}

function subtitleArgs (codes) {
  return [
    '--write-subs', '--write-auto-subs', '--sub-langs', codes.join(','),
    '--convert-subs', 'srt', // keep a .srt next to the video
    '--embed-subs', //          and put the subtitles inside the video too
    // A subtitle that fails (YouTube often rate-limits captions) must not fail the whole download.
    // A real download failure still exits with an error.
    '--ignore-errors'
  ]
}

const jobs = new Map()
const procs = new Map()
const LIVE = ['downloading', 'processing', 'updating']
const jobCookies = new Map() // job id -> cookie spec found during lookup
let win = null

const snapshot = job => ({ ...job })
const emit = job => win && !win.isDestroyed() && win.webContents.send('jobs:update', snapshot(job))

function num (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseProgress (job, line) {
  const [, downloaded, total, estimate, speed, eta] = line.split('|')
  const done = num(downloaded)
  const size = num(total) || num(estimate)
  if (done !== null && size) job.percent = Math.min(100, (done / size) * 100)
  job.speed = num(speed)
  job.eta = num(eta)
}

function startJob (job) {
  job.status = 'downloading'
  emit(job)

  const prepared = cookies.prepare(jobCookies.get(job.id) || null)
  const args = [
    '--no-playlist', '--no-update', '--newline', '--progress', '--windows-filenames',
    '--progress-template', 'download:DVG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print', 'after_move:filepath',
    // --print implies --quiet, which hides the lines we read for "part 2" and "Finishing up".
    '--no-quiet',
    ...PRESETS[job.preset],
    ...(job.subs.length ? subtitleArgs(job.subs) : []),
    ...ffmpegArgs(),
    ...updater.jsRuntimeArgs(),
    ...prepared.args,
    '-o', path.join(job.dir, '%(title).200B [%(id)s].%(ext)s'),
    '--', job.url
  ]

  const proc = spawn(ytdlp(), args, { windowsHide: true })
  procs.set(job.id, proc)
  let buffer = ''
  let stderr = ''
  let lastEmit = 0

  const onLine = line => {
    line = line.trim()
    if (!line) return
    if (line.startsWith('DVG|')) {
      parseProgress(job, line)
    } else if (line.startsWith('[download] Destination:')) {
      // Subtitle files are tiny; don't count them as a "part" of the video.
      if (!/\.(vtt|srt|ass|ssa|ttml|srv\d|json3|lrc|xml)$/i.test(line)) {
        job.part = (job.part || 0) + 1
        job.percent = 0
      }
    } else if (/^\[(Merger|ExtractAudio|VideoRemuxer|Fixup\w*|VideoConvertor|EmbedSubtitle)\]/.test(line)) {
      job.status = 'processing'
      job.speed = null
      job.eta = null
    } else if (path.isAbsolute(line) && !line.startsWith('[')) {
      job.filePath = line
    }
    const now = Date.now()
    if (now - lastEmit > 200 || job.status === 'processing') {
      lastEmit = now
      emit(job)
    }
  }

  proc.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop()
    lines.forEach(onLine)
  })
  proc.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })

  proc.on('error', err => {
    procs.delete(job.id)
    prepared.cleanup()
    job.status = 'error'
    job.error = friendlyError(err)
    emit(job)
    pump()
  })

  proc.on('close', code => {
    procs.delete(job.id)
    prepared.cleanup()
    if (buffer) onLine(buffer)
    if (job.status === 'cancelled') {
      // already reported by cancelJob
    } else if (code === 0) {
      job.status = 'done'
      job.percent = 100
      job.subsSaved = job.subs.length ? countSubtitleFiles(job.filePath) : 0
      job.speed = null
      job.eta = null
    } else if (!job.healed && canHeal(stderr)) {
      healJob(job, friendlyError({ stderr }))
      return
    } else {
      job.status = 'error'
      job.error = friendlyError({ stderr })
      if (needsAuth(stderr)) job.error += ' You may need cookies: see Settings.'
    }
    emit(job)
    pump()
  })
}

// Update yt-dlp, then run the download again from the start (once per job).
async function healJob (job, failure) {
  job.healed = true
  job.status = 'updating'
  job.speed = null
  job.eta = null
  emit(job)
  const changed = await healTools()
  if (job.status !== 'updating') return // cancelled while updating
  if (changed) {
    job.percent = 0
    job.part = 0
    job.error = ''
    startJob(job)
    return
  }
  job.status = 'error'
  job.error = failure
  emit(job)
  pump()
}

function pump () {
  const active = [...jobs.values()].filter(j => LIVE.includes(j.status)).length
  let free = MAX_CONCURRENT - active
  for (const job of jobs.values()) {
    if (free <= 0) break
    if (job.status === 'queued') {
      startJob(job)
      free--
    }
  }
}

function enqueue ({ url, title, thumbnail, preset, subs }) {
  if (!PRESETS[preset]) throw new Error('Unknown format.')
  // Subtitles only make sense with video.
  const subCodes = preset === 'audio' || !Array.isArray(subs)
    ? []
    : [...new Set(subs.filter(c => typeof c === 'string' && SUB_CODE.test(c)))].slice(0, 4)
  const job = {
    id: crypto.randomUUID(),
    url: validateUrl(url),
    title: String(title || url).slice(0, 300),
    thumbnail: /^https:/.test(thumbnail || '') ? thumbnail : '',
    preset,
    dir: settings.downloadDir,
    subs: subCodes,
    subsSaved: 0,
    status: 'queued',
    percent: 0,
    speed: null,
    eta: null,
    part: 0,
    filePath: '',
    error: ''
  }
  const spec = cookieByUrl.get(job.url)
  if (spec) jobCookies.set(job.id, spec)
  jobs.set(job.id, job)
  emit(job)
  pump()
  return snapshot(job)
}

function cancelJob (id) {
  const job = jobs.get(id)
  if (!job) return
  if (job.status === 'queued' || job.status === 'updating') {
    job.status = 'cancelled'
    emit(job)
    return
  }
  const proc = procs.get(id)
  if (proc && ['downloading', 'processing'].includes(job.status)) {
    job.status = 'cancelled'
    emit(job)
    // yt-dlp spawns ffmpeg children, so kill the whole tree.
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {})
  }
}

function removeJob (id) {
  const job = jobs.get(id)
  if (!job || LIVE.includes(job.status)) return
  jobs.delete(id)
  jobCookies.delete(id)
}

// ---------------------------------------------------------------- IPC

function handle (channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (win && event.sender !== win.webContents) throw new Error('Untrusted sender.')
    return fn(...args)
  })
}

function registerIpc () {
  handle('settings:get', () => settings)
  handle('app:systemLanguage', () => systemSubLanguage())
  handle('settings:set', patch => saveSettings(patch || {}))
  handle('settings:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose download folder',
      defaultPath: settings.downloadDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return settings
    return saveSettings({ downloadDir: res.filePaths[0] })
  })
  handle('clipboard:read', () => clipboard.readText())
  handle('info:fetch', url => fetchInfo(url))
  handle('jobs:list', () => [...jobs.values()].map(snapshot))
  handle('jobs:add', opts => enqueue(opts))
  handle('jobs:cancel', id => cancelJob(id))
  handle('jobs:remove', id => removeJob(id))
  handle('jobs:clearFinished', () => {
    for (const [id, job] of jobs) {
      if (['done', 'error', 'cancelled'].includes(job.status)) {
        jobs.delete(id)
        jobCookies.delete(id)
      }
    }
  })
  handle('cookies:status', () => cookies.status())
  handle('cookies:grab', opts => cookies.grabAll({ preferred: opts && opts.browser, allowClose: Boolean(opts && opts.allowClose) }))
  handle('cookies:clear', () => cookies.clearCache())
  handle('cookies:pickFile', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a cookies.txt file',
      properties: ['openFile'],
      filters: [{ name: 'Cookies (Netscape format)', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (res.canceled || !res.filePaths[0]) return settings
    return saveSettings({ cookieFile: res.filePaths[0], cookieMode: 'file' })
  })
  handle('shell:showFile', id => {
    const job = jobs.get(id)
    if (!job) return
    if (job.filePath && fs.existsSync(job.filePath)) shell.showItemInFolder(job.filePath)
    else shell.openPath(job.dir)
  })
  handle('shell:openFolder', () => shell.openPath(settings.downloadDir))
  handle('tools:status', () => updater.status())
  handle('tools:update', opts => updater.update({ force: Boolean(opts && opts.force) }))
  handle('tools:rollback', id => updater.rollback(String(id)))
  handle('tools:selfTest', () => updater.selfTest())
}

// ---------------------------------------------------------------- window

function createWindow () {
  win = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 560,
    minHeight: 520,
    backgroundColor: SURFACE, // same as --surface, so launch never flashes white
    title: 'Duck Video Grabber',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#eee', height: 28 },
    frame: process.platform === 'darwin',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  // Size comes from Windows display scaling only: no zoom shortcuts, no pinch zoom.
  Menu.setApplicationMenu(null)
  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1))
  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, 'src', 'index.html'))

  // Never navigate the app window away, and open external links in the browser.
  win.webContents.on('will-navigate', e => e.preventDefault())

  // Right-click menu. Electron has none by default.
  win.webContents.on('context-menu', (_e, params) => {
    const flags = params.editFlags
    let template = null
    if (params.isEditable) {
      // The link box is the only text field in the app, so it gets a one-step "Paste and look up".
      template = [
        { label: 'Paste and look up', enabled: clipboard.readText().trim() !== '', click: () => win.webContents.send('ui:pasteAndLookUp') },
        { type: 'separator' },
        { role: 'cut', enabled: flags.canCut },
        { role: 'copy', enabled: flags.canCopy },
        { role: 'paste', enabled: flags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: flags.canSelectAll }
      ]
    } else if (params.selectionText.trim()) {
      template = [{ role: 'copy' }]
    }
    if (template) Menu.buildFromTemplate(template).popup({ window: win })
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark' // native menus and dialogs match the dark UI
  loadSettings()
  registerIpc()
  createWindow()
  updater.start()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  for (const [id, proc] of procs) {
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {})
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
