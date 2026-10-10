// Keeps yt-dlp, ffmpeg and the Deno JavaScript runtime current, and undoes updates that break things.
// (yt-dlp needs a JavaScript runtime to solve YouTube's challenges.)
//
// The app installs its own copies into <userData>/tools and prefers them over whatever is
// on PATH, so updating never needs admin rights and never touches system installs
// (a pip-installed yt-dlp can't update itself with -U anyway).
//
// Safety, in order:
//   1. Every download is checked against the publisher's SHA-256 file.
//   2. The new program must pass a real test before it is installed (ffmpeg encodes a
//      second of audio, Deno runs a script, yt-dlp reports its version).
//   3. The old version is kept in tools/backup, so any update can be reverted.
//   4. After yt-dlp or Deno changes, a self-test looks up a stable video. If the new set
//      fails but the old set passes, the app rolls back and skips that release until a
//      newer one appears. If both fail, the network is the likely cause and the update stays.
//
// Files are swapped by renaming, which Windows allows even while the old file is running,
// so a download in progress keeps going on the old binary.

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { once } = require('events')

const YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const YTDLP_EXE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const YTDLP_SUMS = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS'
const FFMPEG_VERSION = 'https://www.gyan.dev/ffmpeg/builds/release-version'
const FFMPEG_ZIP = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
const FFMPEG_SHA = `${FFMPEG_ZIP}.sha256`

const DENO_API = 'https://api.github.com/repos/denoland/deno/releases/latest'
const DENO_TARGET = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
const DENO_ZIP = `https://github.com/denoland/deno/releases/latest/download/deno-${DENO_TARGET}-pc-windows-msvc.zip`
const DENO_SHA = `${DENO_ZIP}.sha256sum`

// The first YouTube video ever: stable for twenty years, so a failure means the tools, not the video.
const SELF_TEST_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

const CHECK_EVERY_MS = 12 * 60 * 60 * 1000
const USER_AGENT = 'DuckVideoGrabber'

const NAMES = { ytdlp: 'yt-dlp', ffmpeg: 'ffmpeg', deno: 'deno' }
const FILES = { ytdlp: ['yt-dlp.exe'], ffmpeg: ['ffmpeg.exe', 'ffprobe.exe'], deno: ['deno.exe'] }

// Windows' own tar (it reads zip files). A bare `tar` can resolve to Git's GNU tar, which cannot.
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function runAll (cmd, args, timeout = 30000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

function versionParts (text) {
  const match = /^\d+(\.\d+)*/.exec(String(text || '').trim())
  return match ? match[0].split('.').map(Number) : null
}

// True when `latest` is a higher version than `installed`. Unreadable installed versions count as older.
function isNewer (latest, installed) {
  const a = versionParts(latest)
  const b = versionParts(installed)
  if (!a) return false
  if (!b) return true
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff) return diff > 0
  }
  return false
}

// Error text that usually means "yt-dlp is out of date", as opposed to a bad link or no network.
function looksBroken (text) {
  return /Unable to extract|n(sig)? ?(function|extraction)|signature extraction|Requested format is not available|Sign in to confirm you.re not a bot|HTTP Error 403|No video formats found|player response|Failed to parse|Did not get any data blocks/i.test(String(text || ''))
}

// First 64-hex-digit hash in a checksum file, whatever its layout.
function firstSha256 (text) {
  const match = /\b[0-9a-fA-F]{64}\b/.exec(String(text || ''))
  return match ? match[0].toLowerCase() : ''
}

// `canary` can replace the real self-test (used by tests): async () => ({ ok, ms, error }).
function createUpdater ({ app, getSettings, saveSettings, send, canary: canaryOverride }) {
  const toolsDir = () => path.join(app.getPath('userData'), 'tools')
  const backupDir = () => path.join(toolsDir(), 'backup')
  const stateFile = () => path.join(toolsDir(), 'state.json')
  const latestSeen = {} // last known latest version per tool, for the status display
  let running = false
  let timer = null

  // ---------------------------------------------------------------- state

  // state.json: { ytdlp: { previous: { version, location: 'backup'|'fallback' }, skip: '2026.08.19' }, ... }
  //   previous.location 'backup'   = the other version is in tools/backup
  //   previous.location 'fallback' = the other version is the bundled/PATH copy, used when our copy is removed
  //   skip = a release that failed its self-test; auto update ignores it and anything older
  function loadState () {
    try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) } catch { return {} }
  }

  function patchState (id, patch) {
    const state = loadState()
    state[id] = { ...(state[id] || {}), ...patch }
    fs.mkdirSync(toolsDir(), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2))
  }

  // The previous version, only if it can really be switched to right now.
  function previousOf (id) {
    const prev = (loadState()[id] || {}).previous
    if (!prev || !prev.version) return null
    if (prev.location === 'backup') {
      return FILES[id].every(f => fs.existsSync(path.join(backupDir(), f))) ? prev : null
    }
    return resolve(NAMES[id]).source === 'managed' ? prev : null
  }

  // ---------------------------------------------------------------- locating tools

  // Order: custom path from Settings, our managed copy, a copy bundled with the app, then PATH.
  function resolve (name) {
    const s = getSettings()
    const override = name === 'yt-dlp' ? s.ytdlpPath : name === 'ffmpeg' ? s.ffmpegPath : ''
    if (override && fs.existsSync(override)) return { bin: override, source: 'custom' }
    const managed = path.join(toolsDir(), `${name}.exe`)
    if (fs.existsSync(managed)) return { bin: managed, source: 'managed' }
    const bundled = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'bin', `${name}.exe`)
    if (fs.existsSync(bundled)) return { bin: bundled, source: 'bundled' }
    return { bin: name, source: 'system' }
  }

  async function installedVersion (name) {
    const { bin } = resolve(name)
    if (name === 'yt-dlp') {
      const r = await runAll(bin, ['--version'], 15000)
      return r.ok ? r.stdout.trim() : null
    }
    if (name === 'deno') {
      const r = await runAll(bin, ['--version'], 15000)
      const match = /^deno (\S+)/m.exec(r.stdout)
      return r.ok && match ? match[1] : null
    }
    const r = await runAll(bin, ['-version'], 15000)
    if (!r.ok) return null
    const match = /ffmpeg version (\S+)/.exec(r.stdout)
    return match ? match[1] : null
  }

  async function status () {
    const s = getSettings()
    const state = loadState()
    const tools = {}
    for (const id of Object.keys(NAMES)) {
      const name = NAMES[id]
      const { bin, source } = resolve(name)
      const version = await installedVersion(name)
      const prev = source === 'custom' ? null : previousOf(id)
      tools[id] = {
        version,
        source: version === null && source === 'system' ? 'missing' : source,
        path: bin,
        latest: latestSeen[id] || '',
        updateAvailable: Boolean(latestSeen[id] && version && isNewer(latestSeen[id], version)),
        previous: prev ? { version: prev.version, older: Boolean(version && isNewer(version, prev.version)) } : null,
        skip: (state[id] || {}).skip || ''
      }
    }
    return { autoUpdate: s.autoUpdateTools, checkedAt: s.toolsCheckedAt, busy: running, tools }
  }

  // ---------------------------------------------------------------- network

  async function get (url, opts = {}) {
    const res = await fetch(url, { redirect: 'follow', signal: opts.signal, headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } })
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
    if (!res.url.startsWith('https://')) throw new Error('Refusing a download that left HTTPS.')
    return res
  }

  async function getText (url) {
    const signal = AbortSignal.timeout(30000)
    return (await get(url, { signal })).text()
  }

  // Streams to a file and returns its SHA-256.
  async function download (url, dest, onPercent) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000)
    try {
      const res = await get(url, { signal: controller.signal })
      const total = Number(res.headers.get('content-length')) || 0
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(dest)
      let received = 0
      for await (const chunk of res.body) {
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, 'drain')
        received += chunk.length
        if (total) onPercent(Math.min(100, (received / total) * 100))
      }
      await new Promise((resolveEnd, reject) => out.end(err => (err ? reject(err) : resolveEnd())))
      return hash.digest('hex')
    } finally {
      clearTimeout(timeout)
    }
  }

  // ---------------------------------------------------------------- installing

  // Delete a file, or if it is running (delete is blocked), rename it out of the way.
  function clearFile (file) {
    try { fs.unlinkSync(file) } catch {
      if (fs.existsSync(file)) { try { fs.renameSync(file, `${file}.stale-${Date.now()}`) } catch {} }
    }
  }

  // Move staged files into tools/, sending the files they replace to tools/backup.
  // keepBackup: the replaced files are thrown away instead, so an existing (older) backup survives.
  function commit (files, { keepBackup = false } = {}) {
    fs.mkdirSync(backupDir(), { recursive: true })
    const moved = []
    try {
      for (const f of files) {
        const to = path.join(toolsDir(), f.name)
        if (fs.existsSync(to)) {
          const saved = keepBackup ? `${to}.old` : path.join(backupDir(), f.name)
          clearFile(saved)
          fs.renameSync(to, saved)
          moved.push({ to, saved })
        }
        fs.renameSync(f.from, to)
      }
    } catch (err) {
      for (const m of moved.reverse()) {
        try { fs.unlinkSync(m.to) } catch {}
        try { fs.renameSync(m.saved, m.to) } catch {}
      }
      throw err
    }
    if (keepBackup) for (const m of moved) clearFile(m.saved)
  }

  function progressEmitter (tool) {
    let last = 0
    return (phase, percent = 0, message = '') => {
      const now = Date.now()
      if (phase === 'downloading' && now - last < 150) return
      last = now
      send('tools:progress', { tool, phase, percent, message })
    }
  }

  async function latestYtdlp () {
    const res = await get(YTDLP_API, { signal: AbortSignal.timeout(30000) })
    const tag = (await res.json()).tag_name
    if (!tag) throw new Error('GitHub did not report a yt-dlp version.')
    return tag
  }

  async function installYtdlp (progress, opts) {
    fs.mkdirSync(toolsDir(), { recursive: true })
    const sums = await getText(YTDLP_SUMS)
    const line = sums.split(/\r?\n/).find(l => /\s\*?yt-dlp\.exe$/.test(l))
    const expected = line ? line.trim().split(/\s+/)[0].toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('Could not read the yt-dlp checksum.')

    const tmp = path.join(toolsDir(), 'yt-dlp.new.exe')
    try {
      progress('downloading', 0)
      const actual = await download(YTDLP_EXE, tmp, p => progress('downloading', p))
      progress('verifying')
      if (actual !== expected) throw new Error('The yt-dlp download failed its checksum, so it was discarded.')
      const test = await runAll(tmp, ['--version'], 20000)
      if (!test.ok) throw new Error('The new yt-dlp would not start, so it was discarded.')
      progress('installing')
      commit([{ from: tmp, name: 'yt-dlp.exe' }], opts)
      return test.stdout.trim()
    } finally {
      try { fs.unlinkSync(tmp) } catch {}
    }
  }

  async function installFfmpeg (progress, opts) {
    fs.mkdirSync(toolsDir(), { recursive: true })
    const expected = firstSha256(await getText(FFMPEG_SHA))
    if (!expected) throw new Error('Could not read the ffmpeg checksum.')

    const zip = path.join(os.tmpdir(), `dvg-ffmpeg-${crypto.randomUUID()}.zip`)
    const stage = path.join(toolsDir(), 'ffmpeg-new')
    try {
      progress('downloading', 0)
      const actual = await download(FFMPEG_ZIP, zip, p => progress('downloading', p))
      progress('verifying')
      if (actual !== expected) throw new Error('The ffmpeg download failed its checksum, so it was discarded.')

      fs.rmSync(stage, { recursive: true, force: true })
      fs.mkdirSync(stage, { recursive: true })
      // Windows 10+ ships bsdtar, which reads zip files. Pull out just the two programs we need.
      const unzip = await runAll(TAR, ['-xf', zip, '-C', stage, '--strip-components=2', '*/bin/ffmpeg.exe', '*/bin/ffprobe.exe'], 120000)
      if (!unzip.ok || !fs.existsSync(path.join(stage, 'ffmpeg.exe')) || !fs.existsSync(path.join(stage, 'ffprobe.exe'))) {
        throw new Error('Could not unpack ffmpeg.')
      }
      const ffmpeg = path.join(stage, 'ffmpeg.exe')
      const info = await runAll(ffmpeg, ['-version'], 20000)
      // A real job: encode one second of audio to MP3 (the app's audio preset relies on this).
      const work = await runAll(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', '-f', 'null', '-'], 30000)
      if (!info.ok || !work.ok) throw new Error('The new ffmpeg failed its test run, so it was discarded.')
      progress('installing')
      commit([{ from: ffmpeg, name: 'ffmpeg.exe' }, { from: path.join(stage, 'ffprobe.exe'), name: 'ffprobe.exe' }], opts)
      const match = /ffmpeg version (\S+)/.exec(info.stdout)
      return match ? match[1] : ''
    } finally {
      try { fs.unlinkSync(zip) } catch {}
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  async function latestDeno () {
    const res = await get(DENO_API, { signal: AbortSignal.timeout(30000) })
    const tag = (await res.json()).tag_name
    if (!tag) throw new Error('GitHub did not report a Deno version.')
    return tag.replace(/^v/, '')
  }

  async function installDeno (progress, opts) {
    fs.mkdirSync(toolsDir(), { recursive: true })
    const expected = firstSha256(await getText(DENO_SHA))
    if (!expected) throw new Error('Could not read the Deno checksum.')

    const zip = path.join(os.tmpdir(), `dvg-deno-${crypto.randomUUID()}.zip`)
    const stage = path.join(toolsDir(), 'deno-new')
    try {
      progress('downloading', 0)
      const actual = await download(DENO_ZIP, zip, p => progress('downloading', p))
      progress('verifying')
      if (actual !== expected) throw new Error('The Deno download failed its checksum, so it was discarded.')

      fs.rmSync(stage, { recursive: true, force: true })
      fs.mkdirSync(stage, { recursive: true })
      const unzip = await runAll(TAR, ['-xf', zip, '-C', stage, 'deno.exe'], 120000)
      if (!unzip.ok || !fs.existsSync(path.join(stage, 'deno.exe'))) throw new Error('Could not unpack Deno.')
      const deno = path.join(stage, 'deno.exe')
      const info = await runAll(deno, ['--version'], 20000)
      const match = /^deno (\S+)/m.exec(info.stdout)
      // A real job: run a script and check its answer.
      const work = await runAll(deno, ['eval', 'console.log(6 * 7)'], 30000)
      if (!info.ok || !match || !work.ok || !/\b42\b/.test(work.stdout)) throw new Error('The new Deno failed its test run, so it was discarded.')
      progress('installing')
      commit([{ from: deno, name: 'deno.exe' }], opts)
      return match[1]
    } finally {
      try { fs.unlinkSync(zip) } catch {}
      fs.rmSync(stage, { recursive: true, force: true })
    }
  }

  // ---------------------------------------------------------------- self-test and rollback

  // Look up the test video with the tools exactly as the app will use them. No cookies.
  async function realCanary () {
    const t0 = Date.now()
    const args = ['--no-update', '--no-warnings', '--ignore-config', '--simulate', '--no-playlist', ...jsRuntimeArgs(), '--', SELF_TEST_URL]
    const r = await runAll(resolve('yt-dlp').bin, args, 60000)
    const errorLine = r.stderr.split(/\r?\n/).filter(l => /ERROR/.test(l)).pop() || ''
    return { ok: r.ok, ms: Date.now() - t0, error: r.ok ? '' : errorLine.replace(/^ERROR:\s*/, '').slice(0, 200) || 'The lookup failed.' }
  }

  const canary = () => (canaryOverride ? canaryOverride() : realCanary())

  // Swap the current version with the previous one. Calling it again swaps back.
  async function swap (id) {
    const name = NAMES[id]
    const { source } = resolve(name)
    if (source === 'custom') throw new Error('This tool uses a custom path.')
    if (!previousOf(id)) throw new Error('There is no other version to switch to.')
    const current = await installedVersion(name)

    fs.mkdirSync(backupDir(), { recursive: true })
    for (const file of FILES[id]) {
      const cur = path.join(toolsDir(), file)
      const bak = path.join(backupDir(), file)
      const tmp = `${cur}.swap`
      if (fs.existsSync(cur)) fs.renameSync(cur, tmp)
      if (fs.existsSync(bak)) fs.renameSync(bak, cur)
      if (fs.existsSync(tmp)) fs.renameSync(tmp, bak)
    }
    patchState(id, { previous: current ? { version: current, location: source === 'managed' ? 'backup' : 'fallback' } : null })
    return { from: current, to: await installedVersion(name) }
  }

  // User-requested switch to the previous version (back, or forward again after going back).
  async function rollback (id) {
    if (!NAMES[id]) throw new Error('Unknown tool.')
    if (running) throw new Error('Wait for the current update to finish.')
    running = true
    try {
      const result = await swap(id)
      if (!result.to) {
        await swap(id) // the other version would not start: put things back
        throw new Error('That version would not start, so nothing was changed.')
      }
      // Going back to an older release: remember the newer one so auto update doesn't undo this.
      patchState(id, { skip: result.from && isNewer(result.from, result.to) ? result.from : '' })
      return result
    } finally {
      running = false
    }
  }

  async function selfTest () {
    if (running) throw new Error('Wait for the current update to finish.')
    running = true
    try {
      return await canary()
    } finally {
      running = false
    }
  }

  // After yt-dlp or Deno changed: make sure the app can still do its main job.
  async function verifyUpdate (changed) {
    send('tools:progress', { tool: 'all', phase: 'selftest' })
    const passes = async () => (await canary()).ok
    if (await passes() || (await sleep(2500), await passes())) return

    // Failed twice. Is it the update, or the network? Put the old versions back and test again.
    const revertable = changed.filter(r => r.from && r.from !== r.to && previousOf(r.tool))
    if (!revertable.length) return
    for (const r of revertable) await swap(r.tool)

    if (await passes()) {
      for (const r of revertable) {
        patchState(r.tool, { skip: r.to })
        r.rolledBackFrom = r.to
        r.to = r.from
        r.status = 'rolled-back'
      }
      send('tools:rolledback', revertable.map(r => ({ name: r.name, bad: r.rolledBackFrom, restored: r.to })))
    } else {
      // The old versions fail too, so the update isn't to blame. Go forward again.
      for (const r of revertable) await swap(r.tool)
    }
  }

  // ---------------------------------------------------------------- update run

  const TOOLS = [
    { id: 'ytdlp', name: 'yt-dlp', latest: latestYtdlp, install: installYtdlp },
    { id: 'ffmpeg', name: 'ffmpeg', latest: async () => (await getText(FFMPEG_VERSION)).trim(), install: installFfmpeg },
    { id: 'deno', name: 'deno', latest: latestDeno, install: installDeno }
  ]

  // force: reinstall the newest version even if the current one is already up to date (and ignore skips).
  // Returns one result per tool: { tool, status: 'updated'|'current'|'skipped'|'rolled-back'|'custom'|'error', from, to, error }.
  async function update ({ force = false, only = null, notify = false } = {}) {
    if (running) return { busy: true, results: [] }
    running = true
    send('tools:progress', { tool: 'all', phase: 'start' })
    const results = []
    try {
      for (const tool of TOOLS) {
        if (only && !only.includes(tool.id)) continue
        const progress = progressEmitter(tool.id)
        const result = { tool: tool.id, name: tool.name, status: 'current', from: '', to: '', error: '' }
        try {
          const before = resolve(tool.name)
          if (before.source === 'custom') {
            result.status = 'custom'
            results.push(result)
            continue
          }
          progress('checking')
          const latest = await tool.latest()
          latestSeen[tool.id] = latest
          const installed = await installedVersion(tool.name)
          result.from = installed || ''
          const skip = (loadState()[tool.id] || {}).skip || ''
          const newer = installed === null || isNewer(latest, installed)

          if (!force && newer && installed !== null && skip && !isNewer(latest, skip)) {
            // This release failed its self-test earlier. Wait for a newer one.
            result.status = 'skipped'
            result.to = installed
            result.skipped = latest
            progress('done')
          } else if (force || newer) {
            // Reinstalling the same version must not overwrite a useful older backup.
            const keepBackup = force && installed !== null && !isNewer(latest, installed)
            result.to = await tool.install(progress, { keepBackup }) || latest
            if (!keepBackup) {
              patchState(tool.id, { previous: installed ? { version: installed, location: before.source === 'managed' ? 'backup' : 'fallback' } : null })
            }
            if (force) patchState(tool.id, { skip: '' })
            result.status = 'updated'
            latestSeen[tool.id] = ''
            progress('done')
          } else {
            result.to = installed
            progress('done')
          }
        } catch (err) {
          result.status = 'error'
          result.error = String(err.message || err)
          progress('error', 0, result.error)
        }
        results.push(result)
      }

      const changed = results.filter(r => r.status === 'updated' && (r.tool === 'ytdlp' || r.tool === 'deno'))
      if (changed.length) await verifyUpdate(changed)

      if (!only && results.every(r => r.status !== 'error')) saveSettings({ toolsCheckedAt: Date.now() })
      const updated = results.filter(r => r.status === 'updated')
      if (notify && updated.length) send('tools:updated', updated.map(r => ({ name: r.name, from: r.from, to: r.to })))
    } finally {
      running = false
      send('tools:progress', { tool: 'all', phase: 'finish' })
    }
    return { busy: false, results }
  }

  // ---------------------------------------------------------------- automatic checks

  async function autoCheck () {
    const s = getSettings()
    if (!s.autoUpdateTools) return
    const stale = Date.now() - (s.toolsCheckedAt || 0) > CHECK_EVERY_MS
    // A tool that won't run (not installed, or broken) is fixed right away, whatever the throttle says.
    const broken = (await Promise.all(['yt-dlp', 'ffmpeg', 'deno'].map(installedVersion))).some(v => v === null)
    if (!stale && !broken) return
    await update({ force: false, notify: true })
  }

  function start () {
    cleanup()
    setTimeout(() => { autoCheck().catch(() => {}) }, 4000) // let the window appear first
    timer = setInterval(() => { autoCheck().catch(() => {}) }, CHECK_EVERY_MS / 2)
    if (timer.unref) timer.unref()
  }

  // Remove leftovers from interrupted installs, and finish any swap that was cut short.
  function cleanup () {
    try {
      for (const file of fs.readdirSync(toolsDir())) {
        const full = path.join(toolsDir(), file)
        if (/\.old$|\.new\.exe$/.test(file)) { try { fs.unlinkSync(full) } catch {} }
        if (file === 'ffmpeg-new' || file === 'deno-new') fs.rmSync(full, { recursive: true, force: true })
        if (file.endsWith('.swap')) {
          const cur = full.slice(0, -'.swap'.length)
          const bak = path.join(backupDir(), path.basename(cur))
          try {
            if (!fs.existsSync(cur)) fs.renameSync(full, cur)
            else if (!fs.existsSync(bak)) fs.renameSync(full, bak)
            else fs.unlinkSync(full)
          } catch {}
        }
      }
      for (const file of fs.readdirSync(backupDir())) {
        if (/\.stale-\d+$/.test(file)) { try { fs.unlinkSync(path.join(backupDir(), file)) } catch {} }
      }
    } catch {}
  }

  // Arguments that point yt-dlp at our Deno. A Deno found on PATH is picked up by yt-dlp on its own.
  function jsRuntimeArgs () {
    const { bin, source } = resolve('deno')
    return source === 'system' ? [] : ['--js-runtimes', `deno:${bin}`]
  }

  return { resolve, status, update, rollback, selfTest, start, jsRuntimeArgs, isBusy: () => running }
}

module.exports = { createUpdater, isNewer, looksBroken }
