// Browser cookie detection, grabbing and caching for yt-dlp.
//
// Why a cache: Chromium browsers lock their cookie database while running, and
// recent Chrome/Edge/Brave versions encrypt cookies in a way yt-dlp cannot read
// (see yt-dlp issue 10927). Firefox works reliably. Once a grab succeeds, the
// cookies are saved to one file so later downloads don't depend on the live browser.

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const local = process.env.LOCALAPPDATA || ''
const roaming = process.env.APPDATA || ''

const BROWSERS = {
  firefox: { label: 'Firefox', exe: 'firefox.exe', dir: path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'), progId: /^FirefoxURL/i },
  chrome: { label: 'Chrome', exe: 'chrome.exe', dir: path.join(local, 'Google', 'Chrome', 'User Data'), progId: /^ChromeHTML/i },
  edge: { label: 'Edge', exe: 'msedge.exe', dir: path.join(local, 'Microsoft', 'Edge', 'User Data'), progId: /^MSEdgeHTM/i },
  brave: { label: 'Brave', exe: 'brave.exe', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), progId: /^BraveHTML/i },
  vivaldi: { label: 'Vivaldi', exe: 'vivaldi.exe', dir: path.join(local, 'Vivaldi', 'User Data'), progId: /^VivaldiHTM/i },
  opera: { label: 'Opera', exe: 'opera.exe', dir: path.join(roaming, 'Opera Software', 'Opera Stable'), progId: /^OperaStable/i },
  chromium: { label: 'Chromium', exe: 'chromium.exe', dir: path.join(local, 'Chromium', 'User Data'), progId: /^ChromiumHTM/i }
}

const label = id => (BROWSERS[id] ? BROWSERS[id].label : id)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Never rejects: yt-dlp exits non-zero for plenty of normal reasons.
function runAll (cmd, args, timeout = 60000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, spawnError: err && err.code === 'ENOENT', stdout, stderr })
    })
  })
}

// ---------------------------------------------------------------- error classification

function classifyCookieError (text) {
  if (/Could not copy .*cookie|database is locked|being used by another process|WinError 32|PermissionError/i.test(text)) return 'locked'
  if (/decrypt|DPAPI/i.test(text)) return 'decrypt'
  if (/could not find .*cookies? (database|file)|Unsupported browser|profile .*not found/i.test(text)) return 'missing'
  return null
}

function needsAuth (text) {
  return /sign in|log ?in|age[- ]restricted|confirm your age|private video|members[- ]only|not a bot|authentication|requires? (an )?account|use --cookies|HTTP Error 40[13]/i.test(text)
}

function reasonMessage (reason, browser) {
  const name = label(browser)
  switch (reason) {
    case 'locked': return `${name} is open and has locked its cookie file.`
    case 'decrypt': return `${name} encrypts its cookies in a way yt-dlp can't read yet.`
    case 'missing': return `Couldn't find a ${name} profile with cookies.`
    case 'empty': return `${name} had no cookies to grab.`
    default: return `Couldn't read ${name} cookies.`
  }
}

// ---------------------------------------------------------------- factory

function createCookies ({ app, getSettings, saveSettings, ytdlp }) {
  const cacheFile = () => path.join(app.getPath('userData'), 'cookies-cache.txt')
  const badBrowsers = new Set() // browsers that failed to decrypt this session; skipped by auto mode

  async function defaultBrowserId () {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice'
    const { stdout } = await runAll('reg', ['query', key, '/v', 'ProgId'], 5000)
    const match = /ProgId\s+REG_SZ\s+(\S+)/.exec(stdout || '')
    if (!match) return null
    return Object.keys(BROWSERS).find(id => BROWSERS[id].progId.test(match[1])) || null
  }

  // Installed browsers, default first, then Firefox (most reliable), then the rest.
  async function detect () {
    const installed = Object.keys(BROWSERS).filter(id => fs.existsSync(BROWSERS[id].dir))
    const def = await defaultBrowserId()
    const order = [def, 'firefox', ...Object.keys(BROWSERS)].filter((id, i, all) => id && all.indexOf(id) === i && installed.includes(id))
    return order.map(id => ({ id, label: label(id), isDefault: id === def }))
  }

  function cacheInfo () {
    try {
      const stat = fs.statSync(cacheFile())
      const count = fs.readFileSync(cacheFile(), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).length
      return { exists: true, count, updated: stat.mtimeMs }
    } catch {
      return { exists: false, count: 0, updated: 0 }
    }
  }

  async function status () {
    const s = getSettings()
    return { browsers: await detect(), cache: cacheInfo(), mode: s.cookieMode, browser: s.cookieBrowser, file: s.cookieFile }
  }

  function clearCache () {
    try { fs.unlinkSync(cacheFile()) } catch {}
    return cacheInfo()
  }

  // ---------------------------------------------------------------- per-request cookies

  // A "spec" is null (no cookies), { browser } or { file }. Files are copied to a temp
  // file first because yt-dlp rewrites the cookie file on exit, and two downloads
  // running at once must not write to the same one.
  function prepare (spec) {
    if (!spec) return { args: [], cleanup () {} }
    if (spec.browser) return { args: ['--cookies-from-browser', spec.browser], cleanup () {} }
    const tmp = path.join(os.tmpdir(), `dvg-${crypto.randomUUID()}.txt`)
    try {
      fs.copyFileSync(spec.file, tmp)
    } catch {
      return { args: [], cleanup () {} }
    }
    return { args: ['--cookies', tmp], cleanup () { try { fs.unlinkSync(tmp) } catch {} } }
  }

  async function candidates () {
    const s = getSettings()
    if (s.cookieMode === 'off') return [null]
    if (s.cookieMode === 'file') return s.cookieFile && fs.existsSync(s.cookieFile) ? [{ file: s.cookieFile }] : [null]
    if (s.cookieMode === 'browser') return [{ browser: s.cookieBrowser }]
    // auto: no cookies first, then the saved grab, then each browser, last-known-good first
    const list = [null]
    if (cacheInfo().exists) list.push({ file: cacheFile() })
    const browsers = (await detect()).map(b => b.id).filter(id => !badBrowsers.has(id))
    if (s.lastCookieBrowser && browsers.includes(s.lastCookieBrowser)) browsers.unshift(...browsers.splice(browsers.indexOf(s.lastCookieBrowser), 1))
    for (const id of browsers) list.push({ browser: id })
    return list
  }

  // Run a yt-dlp request, retrying with cookies when the site asks for a sign-in.
  // buildArgs(cookieArgs) returns the full argument list.
  async function request (buildArgs, timeout = 90000) {
    const specs = await candidates()
    const auto = getSettings().cookieMode === 'auto'
    let first = null
    let cookieIssue = null
    let sawAuth = false

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]
      const prepared = prepare(spec)
      const result = await runAll(ytdlp(), buildArgs(prepared.args), timeout)
      prepared.cleanup()

      if (result.code === 0) {
        if (spec && spec.browser && auto) saveSettings({ lastCookieBrowser: spec.browser })
        return { ok: true, result, spec }
      }
      if (result.spawnError) return { ok: false, result, first: result, cookieIssue: null, needsAuth: false }

      const text = `${result.stderr}\n${result.stdout.slice(0, 2000)}`
      const reason = spec && spec.browser ? classifyCookieError(text) : null
      if (reason) {
        cookieIssue = { browser: spec.browser, reason, message: reasonMessage(reason, spec.browser) }
        if (reason === 'decrypt' || reason === 'missing') badBrowsers.add(spec.browser)
      } else {
        if (!first) first = result
        if (needsAuth(text)) sawAuth = true
        // A plain failure with no cookies that isn't about signing in: cookies won't help.
        if (i === 0 && !sawAuth) break
      }
      if (!auto) break
    }
    return { ok: false, result: first, first, cookieIssue, needsAuth: sawAuth }
  }

  // ---------------------------------------------------------------- grabbing

  async function killBrowser (id) {
    await runAll('taskkill', ['/IM', BROWSERS[id].exe, '/F', '/T'], 10000)
    await sleep(1500)
  }

  async function grab (browser, allowClose) {
    if (!BROWSERS[browser]) return { ok: false, browser, reason: 'missing', message: 'Unknown browser.' }
    const tmp = path.join(os.tmpdir(), `dvg-grab-${crypto.randomUUID()}.txt`)
    // Not quiet, so yt-dlp prints "Extracted N cookies from ...". The URL is never fetched in a meaningful way.
    const args = ['--no-update', '--no-warnings', '--cookies-from-browser', browser, '--cookies', tmp, '--simulate', '--', 'https://example.com/']
    let closed = false
    let result = await runAll(ytdlp(), args)
    let reason = classifyCookieError(`${result.stderr}\n${result.stdout}`)
    if (reason === 'locked' && allowClose) {
      await killBrowser(browser)
      closed = true
      result = await runAll(ytdlp(), args)
      reason = classifyCookieError(`${result.stderr}\n${result.stdout}`)
    }
    const found = /Extracted (\d+) cookies/.exec(`${result.stdout}\n${result.stderr}`)
    const count = found ? Number(found[1]) : 0
    if (!reason && count === 0) reason = result.spawnError ? 'other' : 'empty'

    if (!reason && fs.existsSync(tmp)) {
      fs.mkdirSync(path.dirname(cacheFile()), { recursive: true })
      fs.copyFileSync(tmp, cacheFile())
      try { fs.unlinkSync(tmp) } catch {}
      saveSettings({ lastCookieBrowser: browser })
      return { ok: true, browser, count: cacheInfo().count, closed } // count the saved file so it matches the status line
    }
    try { fs.unlinkSync(tmp) } catch {}
    return { ok: false, browser, reason: reason || 'other', message: reasonMessage(reason, browser), closed }
  }

  // Try the chosen browser, then every other installed one, until one works.
  async function grabAll ({ preferred, allowClose }) {
    const s = getSettings()
    const installed = (await detect()).map(b => b.id)
    let targets = s.cookieMode === 'browser' ? [s.cookieBrowser] : installed
    if (preferred && installed.includes(preferred)) targets = [preferred, ...targets.filter(id => id !== preferred)]
    if (!targets.length) return { ok: false, tried: [], message: 'No supported browsers were found.' }

    const tried = []
    for (const id of targets) {
      const outcome = await grab(id, allowClose)
      tried.push(outcome)
      if (outcome.ok) {
        badBrowsers.delete(id)
        return { ok: true, tried, cache: cacheInfo() }
      }
    }
    return { ok: false, tried, cache: cacheInfo() }
  }

  return { BROWSERS, status, detect, cacheInfo, clearCache, request, prepare, grabAll, label }
}

module.exports = { createCookies, BROWSERS, needsAuth }
