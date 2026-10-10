'use strict'

// ------------------------------------------------------------------ helpers

const $ = sel => document.querySelector(sel)

// Build DOM without innerHTML so titles and errors from the web can never inject markup.
function el (tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child.nodeType ? child : document.createTextNode(child))
  }
  return node
}

// Lucide icon paths (ISC licence, see THIRD-PARTY-NOTICES.md).
const ICONS = {
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  settings: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  folder: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  cookie: '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'
}

function icon (name) {
  const wrap = document.createElement('span')
  wrap.style.display = 'contents'
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
  return wrap.firstChild
}

function formatDuration (s) {
  s = Math.round(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function formatSpeed (bps) {
  if (!bps) return ''
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s']
  let i = 0
  while (bps >= 1024 && i < units.length - 1) { bps /= 1024; i++ }
  return `${bps.toFixed(i ? 1 : 0)} ${units[i]}`
}

function languageName (code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code
  } catch {
    return code
  }
}

// "Spanish · español": the English name, plus the language's own name when it differs.
function languageLabel (code) {
  const name = languageName(code)
  let own = ''
  try { own = new Intl.DisplayNames([code], { type: 'language' }).of(code) || '' } catch {}
  return own && own.toLowerCase() !== name.toLowerCase() ? `${name} · ${own}` : name
}

const SUB_LANGUAGES = [
  'ar', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fil', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja',
  'ko', 'ms', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-Hans', 'zh-Hant'
].sort((a, b) => languageName(a).localeCompare(languageName(b)))

function safeImg (url, alt = '') {
  if (!/^https:\/\//.test(url || '')) return null
  return el('img', { src: url, alt, loading: 'lazy', referrerpolicy: 'no-referrer' })
}

// ------------------------------------------------------------------ toasts

function toast (message, type = 'ok') {
  const host = $('#toasts')
  while (host.children.length >= 2) host.firstChild.remove() // two at a time
  const node = el('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status' },
    el('span', { class: 'dot' }),
    el('span', { class: 'msg', text: message }),
    el('button', { class: 'btn btn-square', 'aria-label': 'Dismiss', onClick: () => dismiss() }, icon('x'))
  )
  let timer
  const dismiss = () => {
    clearTimeout(timer)
    node.classList.add('out')
    setTimeout(() => node.remove(), 200)
  }
  timer = setTimeout(dismiss, 10000)
  host.append(node)
}

// ------------------------------------------------------------------ confirm dialog

// Soft modal: vignette + blur backdrop, dialog grows from 0.95, Escape closes.
function confirmDialog ({ title, body, confirmText }) {
  return new Promise(resolve => {
    const previous = document.activeElement
    const close = value => {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      if (previous && previous.focus) previous.focus()
      resolve(value)
    }
    const onKey = e => { if (e.key === 'Escape') close(false) }
    const okBtn = el('button', { class: 'btn btn-primary', text: confirmText, onClick: () => close(true) })
    const backdrop = el('div', { class: 'modal-backdrop', onClick: e => { if (e.target === backdrop) close(false) } },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('h2', { text: title }),
        el('p', { text: body }),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', text: 'Cancel', onClick: () => close(false) }),
          okBtn
        )
      )
    )
    document.body.append(backdrop)
    document.addEventListener('keydown', onKey)
    okBtn.focus()
  })
}

// ------------------------------------------------------------------ state

const state = {
  page: 'download',
  settings: null,
  jobs: new Map(),
  fetchToken: 0
}

const PRESETS = [
  { id: 'best', label: 'Best', height: 0 },
  { id: '1080', label: '1080p', height: 1080 },
  { id: '720', label: '720p', height: 720 },
  { id: '480', label: '480p', height: 480 },
  { id: 'audio', label: 'Audio (MP3)', height: 0 }
]

const ACTIVE = ['queued', 'downloading', 'processing', 'updating']
const FINISHED = ['done', 'error', 'cancelled']

function applySettings (s) {
  state.settings = s
  const root = document.documentElement
  if (s.theme === 'amoled') root.dataset.theme = 'amoled'
  else delete root.dataset.theme
}

// ------------------------------------------------------------------ shell

const PAGES = [
  { id: 'download', label: 'Download', icon: 'download' },
  { id: 'downloads', label: 'Downloads', icon: 'list' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

const pageNodes = {}
const navNodes = {}
let badge

function buildShell () {
  const nav = $('#nav')
  nav.append(el('img', { class: 'logo', src: 'logo.svg', alt: '', 'aria-hidden': 'true', draggable: 'false' }))
  for (const page of PAGES) {
    const btn = el('button', {
      class: 'nav-link',
      title: page.label,
      'aria-label': page.label,
      onClick: () => showPage(page.id)
    }, icon(page.icon))
    if (page.id === 'downloads') {
      badge = el('span', { class: 'nav-badge hidden' })
      btn.append(badge)
    }
    navNodes[page.id] = btn
    nav.append(btn)
  }

  const content = $('#content')
  pageNodes.download = buildDownloadPage()
  pageNodes.downloads = buildDownloadsPage()
  pageNodes.settings = buildSettingsPage()
  for (const node of Object.values(pageNodes)) content.append(node)
  showPage('download')
}

function showPage (id, anchor) {
  state.page = id
  for (const [key, node] of Object.entries(pageNodes)) {
    node.classList.toggle('hidden', key !== id)
    navNodes[key].classList.toggle('active', key === id)
    if (key === id) navNodes[key].setAttribute('aria-current', 'page')
    else navNodes[key].removeAttribute('aria-current')
  }
  $('#content').scrollTop = 0
  if (id === 'settings') {
    refreshTools()
    refreshCookies()
    if (anchor === 'cookies') cookieAnchor.scrollIntoView({ block: 'start' })
  }
}

function updateBadge () {
  const n = [...state.jobs.values()].filter(j => ACTIVE.includes(j.status)).length
  badge.textContent = String(n)
  badge.classList.toggle('hidden', n === 0)
}

// ------------------------------------------------------------------ download page

let urlInput, fetchBtn, result

function buildDownloadPage () {
  urlInput = el('input', {
    class: 'input',
    type: 'url',
    placeholder: 'Paste a video link…',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': 'Video link',
    onKeydown: e => { if (e.key === 'Enter') doFetch() }
  })
  fetchBtn = el('button', { class: 'btn btn-primary', onClick: doFetch }, icon('search'), 'Look up')
  const pasteBtn = el('button', { class: 'btn', onClick: pasteAndLookUp }, icon('clipboard'), 'Paste')

  result = el('div', { class: 'section-gap' }, emptyHint())

  return el('section', { class: 'page' },
    el('h1', { class: 'page-title', text: 'Grab a video' }),
    el('div', { class: 'url-row section-gap' }, urlInput, pasteBtn, fetchBtn),
    result
  )
}

// Used by the Paste button and the right-click menu.
async function pasteAndLookUp () {
  const text = (await window.duck.readClipboard()).trim()
  if (!text) return toast('Your clipboard is empty.', 'err')
  if (state.page !== 'download') showPage('download')
  urlInput.value = text
  doFetch()
}

function emptyHint () {
  return el('div', { class: 'empty compact' }, icon('film'), 'Your video will show up here')
}

function skeletonCard () {
  return el('div', { class: 'card', 'aria-busy': 'true' },
    el('div', { class: 'card-art skeloader' }),
    el('div', { class: 'card-body' },
      el('div', { class: 'skel-line skeloader' }),
      el('div', { class: 'skel-line skeloader' }),
      el('div', { class: 'skel-line skeloader' })
    )
  )
}

async function doFetch () {
  const url = urlInput.value.trim()
  if (!url) return urlInput.focus()
  const token = ++state.fetchToken
  fetchBtn.disabled = true
  result.replaceChildren(skeletonCard())
  try {
    const res = await window.duck.fetchInfo(url)
    if (token !== state.fetchToken) return
    result.replaceChildren(res.ok ? infoCard(res.info) : errorPanel(res))
  } catch (err) {
    if (token !== state.fetchToken) return
    result.replaceChildren(emptyHint())
    toast(cleanIpcError(err), 'err')
  } finally {
    if (token === state.fetchToken) fetchBtn.disabled = false
  }
}

function errorPanel (res) {
  const cookieHelp = res.needsAuth || res.cookieIssue
  return el('div', { class: 'empty compact load-in', role: 'alert' },
    icon('alert'),
    el('div', { text: res.error }),
    cookieHelp
      ? el('p', { class: 'empty-detail', text: res.needsAuth
        ? 'This site wants you to be signed in. Sign in with your browser, then let the app grab its cookies.'
        : res.cookieIssue })
      : null,
    cookieHelp
      ? el('button', { class: 'btn', onClick: () => showPage('settings', 'cookies') }, icon('cookie'), 'Open cookie settings')
      : null
  )
}

// Electron wraps main-process errors as "Error invoking remote method '…': Error: …"
function cleanIpcError (err) {
  return String(err.message || err).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

function infoCard (info) {
  let preset = 'best'
  const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Quality' })
  const buttons = PRESETS.map(p => {
    const unavailable = Boolean(p.height && info.maxHeight && p.height > info.maxHeight)
    const btn = el('button', {
      class: 'seg-item' + (p.id === preset ? ' active' : ''),
      role: 'radio',
      'aria-checked': String(p.id === preset),
      disabled: unavailable,
      title: unavailable ? 'Not available for this video' : null,
      text: p.label,
      onClick: () => {
        preset = p.id
        buttons.forEach((b, i) => {
          b.classList.toggle('active', PRESETS[i].id === preset)
          b.setAttribute('aria-checked', String(PRESETS[i].id === preset))
        })
        syncSubs()
      }
    })
    return btn
  })
  seg.append(...buttons)

  // Subtitles: on by default when the video has them in your language or English.
  const subs = info.subtitles || []
  const subsInput = el('input', { type: 'checkbox', checked: subs.length > 0 })
  const sub = subs[0]
  const wantedName = languageName(info.subtitleLanguage || 'en')
  const subsWrap = el('label', {
    class: 'check',
    title: sub
      ? `${languageName(sub.lang)}${sub.auto ? ' (auto-generated)' : ''}${sub.fallback ? `, because ${wantedName} isn't available` : ''}. Saved as an .srt file and inside the video.`
      : `This video has no ${wantedName}${wantedName === 'English' ? '' : ' or English'} subtitles`
  }, subsInput, el('span', { class: 'check-box', 'aria-hidden': 'true' }), el('span', { text: subs.length ? 'Subtitles' : 'No subtitles' }))
  function syncSubs () {
    const off = subs.length === 0 || preset === 'audio'
    subsInput.disabled = off
    subsWrap.classList.toggle('disabled', off)
  }
  syncSubs()

  const meta = [info.uploader, info.site, info.duration ? formatDuration(info.duration) : '', info.usedCookies ? `Using ${info.usedCookies} cookies` : '']
    .filter(Boolean)
    .map(text => el('span', { text }))

  const img = safeImg(info.thumbnail, '')
  const art = el('div', { class: 'card-art' }, img, info.duration ? el('span', { class: 'duration', text: formatDuration(info.duration) }) : null)

  const dlBtn = el('button', {
    class: 'btn btn-primary',
    onClick: async () => {
      dlBtn.disabled = true
      try {
        const wantSubs = subsInput.checked && !subsInput.disabled
        await window.duck.addJob({ url: info.url, title: info.title, thumbnail: info.thumbnail, preset, subs: wantSubs ? subs.map(s => s.code) : [] })
        toast('Added to Downloads.')
      } catch (err) {
        toast(cleanIpcError(err), 'err')
      } finally {
        dlBtn.disabled = false
      }
    }
  }, icon('download'), 'Download')

  const where = el('span', { class: 'where', text: `Saving to ${state.settings.downloadDir}` })

  return el('div', { class: 'card load-in' },
    art,
    el('div', { class: 'card-body' },
      el('h2', { class: 'card-title', text: info.title }),
      el('div', { class: 'meta' }, meta),
      el('div', {}, el('div', { class: 'field-label', text: 'Quality' }), el('div', { class: 'quality-row' }, seg, subsWrap)),
      el('div', { class: 'card-actions' }, dlBtn, where)
    )
  )
}

// ------------------------------------------------------------------ downloads page

let jobsList, jobsEmpty
const jobRows = new Map()

function buildDownloadsPage () {
  jobsList = el('div', { class: 'jobs' })
  jobsEmpty = el('div', { class: 'empty' }, icon('list'), 'Nothing here yet. Grab a video to get started.')

  return el('section', { class: 'page' },
    el('div', { class: 'page-head' },
      el('h1', { class: 'page-title', text: 'Downloads' }),
      el('div', { class: 'btns' },
        el('button', { class: 'btn', onClick: () => window.duck.openFolder() }, icon('folder'), 'Open folder'),
        el('button', {
          class: 'btn',
          onClick: async () => {
            await window.duck.clearFinished()
            for (const [id, job] of [...state.jobs]) {
              if (FINISHED.includes(job.status)) removeRow(id)
            }
          }
        }, icon('trash'), 'Clear finished')
      )
    ),
    jobsList,
    jobsEmpty
  )
}

function statusText (job) {
  switch (job.status) {
    case 'queued': return 'Waiting in queue'
    case 'downloading': {
      const parts = [`${job.percent.toFixed(1)}%`]
      if (job.speed) parts.push(formatSpeed(job.speed))
      if (job.eta) parts.push(`${formatDuration(job.eta)} left`)
      if (job.part > 1) parts.push(`part ${job.part}`)
      return parts.join(' • ')
    }
    case 'processing': return 'Finishing up…'
    case 'updating': return 'Updating yt-dlp, then trying again…'
    case 'done':
      if (!job.subs || !job.subs.length) return 'Finished'
      return job.subsSaved ? 'Finished · with subtitles' : 'Finished · subtitles could not be saved'
    case 'cancelled': return 'Cancelled'
    case 'error': return 'Failed'
    default: return job.status
  }
}

function buildRow (job) {
  const art = el('div', { class: 'job-art' }, safeImg(job.thumbnail))
  const title = el('div', { class: 'job-title', text: job.title, title: job.title })
  const statusLabel = el('span')
  const status = el('div', { class: 'job-status' }, el('span', { class: 'dot' }), statusLabel)
  const fill = el('i')
  const bar = el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill)
  const error = el('div', { class: 'job-error hidden' })
  const actions = el('div', { class: 'job-actions' })
  const root = el('article', { class: 'job load-in' },
    art,
    el('div', { class: 'job-main' }, title, status, bar, error),
    actions
  )
  return { root, statusLabel, fill, bar, error, actions }
}

function updateRow (job) {
  let row = jobRows.get(job.id)
  if (!row) {
    row = buildRow(job)
    jobRows.set(job.id, row)
    jobsList.prepend(row.root)
  }
  const prevStatus = row.root.dataset.status
  row.root.className = row.root.className.replace(/\bs-\w+/g, '').trim() + ` s-${job.status}`
  row.root.dataset.status = job.status
  row.statusLabel.textContent = statusText(job)
  row.fill.style.width = `${job.status === 'done' ? 100 : job.percent}%`
  row.bar.setAttribute('aria-valuenow', String(Math.round(job.percent)))
  row.error.textContent = job.error || ''
  row.error.classList.toggle('hidden', !job.error)

  if (prevStatus !== job.status) {
    row.actions.replaceChildren(...rowActions(job))
  }
}

function rowActions (job) {
  const out = []
  if (ACTIVE.includes(job.status)) {
    out.push(el('button', { class: 'btn btn-square', title: 'Cancel', 'aria-label': 'Cancel download', onClick: () => window.duck.cancelJob(job.id) }, icon('x')))
  } else {
    if (job.status === 'done') {
      out.push(el('button', { class: 'btn btn-square', title: 'Show in folder', 'aria-label': 'Show in folder', onClick: () => window.duck.showFile(job.id) }, icon('folder')))
    }
    out.push(el('button', {
      class: 'btn btn-square',
      title: 'Remove from list',
      'aria-label': 'Remove from list',
      onClick: async () => { await window.duck.removeJob(job.id); removeRow(job.id) }
    }, icon('trash')))
  }
  return out
}

function removeRow (id) {
  const row = jobRows.get(id)
  if (row) row.root.remove()
  jobRows.delete(id)
  state.jobs.delete(id)
  syncJobsUi()
}

function syncJobsUi () {
  jobsEmpty.classList.toggle('hidden', state.jobs.size > 0)
  updateBadge()
}

function onJobUpdate (job) {
  const prev = state.jobs.get(job.id)
  state.jobs.set(job.id, job)
  updateRow(job)
  syncJobsUi()
  if (prev && prev.status !== job.status) {
    if (job.status === 'done') toast(`Finished: ${job.title}`)
    if (job.status === 'error') toast(`Download failed: ${job.error || job.title}`, 'err')
  }
}

// ------------------------------------------------------------------ settings page

let folderText, languageSelect
let themeButtons = []

function buildSettingsPage () {
  folderText = el('p', { class: 'one-line' })

  const themes = [{ id: 'default', label: 'Default' }, { id: 'amoled', label: 'AMOLED' }]
  const themeSeg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' })
  themeButtons = themes.map(t => el('button', {
    class: 'seg-item',
    role: 'radio',
    text: t.label,
    onClick: async () => {
      applySettings(await window.duck.setSettings({ theme: t.id }))
      syncSettings()
    }
  }))
  themeSeg.append(...themeButtons)

  languageSelect = el('select', {
    class: 'select',
    'aria-label': 'Preferred language',
    onChange: async e => applySettings(await window.duck.setSettings({ subLanguage: e.target.value }))
  }, el('option', { value: 'system', text: 'System default' }),
  ...SUB_LANGUAGES.map(code => el('option', { value: code, text: languageLabel(code) })))

  const row = (title, info, control) => el('div', { class: 'setting' },
    el('div', { class: 'info' }, el('h3', { text: title }), info),
    control ? el('div', { class: 'control' }, control) : null
  )

  // A section label above one card; the card's rows are split by hairlines.
  const group = (title, rows) => {
    const label = el('h2', { class: 'section-title', text: title })
    return { label, nodes: [label, el('div', { class: 'settings-group' }, rows)] }
  }

  const general = group('General', [
    row('Download folder', folderText, el('button', {
      class: 'btn',
      onClick: async () => { applySettings(await window.duck.pickFolder()); syncSettings() }
    }, icon('folder'), 'Change')),
    row('Theme', null, themeSeg),
    row('Preferred language', el('p', { text: 'For subtitles. English is used when a video doesn\'t have it.' }), languageSelect)
  ])
  const cookies = group('Cookies', buildCookieRows(row))
  cookieAnchor = cookies.label
  const tools = group('Tools', buildToolRows(row))

  return el('section', { class: 'page' },
    el('h1', { class: 'page-title', text: 'Settings' }),
    el('div', { class: 'settings' }, ...general.nodes, ...cookies.nodes, ...tools.nodes)
  )
}

// ---- cookies

const COOKIE_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'browser', label: 'Browser' },
  { id: 'file', label: 'File' },
  { id: 'off', label: 'Off' }
]

const cookieUi = {}
let cookieAnchor
let cookieStatus = { browsers: [], cache: { exists: false } }

function buildCookieRows (row) {
  cookieUi.modeButtons = COOKIE_MODES.map(m => el('button', {
    class: 'seg-item',
    role: 'radio',
    text: m.label,
    onClick: async () => {
      applySettings(await window.duck.setSettings({ cookieMode: m.id }))
      refreshCookies()
    }
  }))
  const modeSeg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Cookie source' }, cookieUi.modeButtons)

  cookieUi.modeHint = el('p')
  cookieUi.browserSeg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Browser' })
  cookieUi.fileText = el('p', { class: 'one-line' })

  cookieUi.grabBtn = el('button', {
    class: 'btn',
    title: 'Read cookies from your browsers and save them for later downloads',
    onClick: () => runCookieGrab(false)
  }, icon('cookie'), 'Grab now')
  cookieUi.forceBtn = el('button', {
    class: 'btn',
    title: 'Like Grab now, but closes a browser that has locked its cookies (asks first)',
    onClick: () => runCookieGrab(true)
  }, icon('refresh'), 'Force grab')
  cookieUi.clearBtn = el('button', {
    class: 'btn btn-square',
    title: 'Delete saved cookies',
    'aria-label': 'Delete saved cookies',
    onClick: async () => {
      await window.duck.clearCookies()
      cookieUi.log.classList.add('hidden')
      refreshCookies()
      toast('Saved cookies deleted.')
    }
  }, icon('trash'))
  cookieUi.cacheText = el('p')
  cookieUi.log = el('p', { class: 'pre hidden' })

  cookieUi.rowMode = row('Source', cookieUi.modeHint, modeSeg)
  cookieUi.rowBrowser = row('Browser', null, cookieUi.browserSeg)
  cookieUi.rowFile = row('File', cookieUi.fileText, el('button', {
    class: 'btn',
    onClick: async () => { applySettings(await window.duck.pickCookieFile()); refreshCookies() }
  }, icon('folder'), 'Choose file'))
  cookieUi.rowGrab = row('Saved cookies', [cookieUi.cacheText, cookieUi.log], [cookieUi.grabBtn, cookieUi.forceBtn, cookieUi.clearBtn])

  return [cookieUi.rowMode, cookieUi.rowBrowser, cookieUi.rowFile, cookieUi.rowGrab]
}

function ago (ms) {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

async function refreshCookies () {
  cookieStatus = await window.duck.cookieStatus()
  const { browsers, cache, mode, browser, file } = cookieStatus
  const found = browsers.length
    ? `Found: ${browsers.map(b => b.label + (b.isDefault ? ' (default)' : '')).join(', ')}.`
    : 'No supported browsers found.'

  cookieUi.modeButtons.forEach((b, i) => {
    const active = COOKIE_MODES[i].id === mode
    b.classList.toggle('active', active)
    b.setAttribute('aria-checked', String(active))
  })
  cookieUi.modeHint.textContent = {
    auto: 'Only when a site asks you to sign in',
    browser: 'Always from the browser below',
    file: 'Always from your cookies.txt',
    off: 'Sign-in-only videos will fail'
  }[mode]
  cookieUi.modeHint.title = mode === 'auto'
    ? 'Tries without cookies first. If a site asks you to sign in, it uses your saved cookies, then your browsers.'
    : ''

  cookieUi.rowBrowser.classList.toggle('hidden', mode !== 'browser')
  cookieUi.rowFile.classList.toggle('hidden', mode !== 'file')
  cookieUi.rowGrab.classList.toggle('hidden', mode === 'file' || mode === 'off')

  cookieUi.browserSeg.replaceChildren(...browsers.map(b => el('button', {
    class: 'seg-item' + (b.id === browser ? ' active' : ''),
    role: 'radio',
    'aria-checked': String(b.id === browser),
    text: b.label,
    onClick: async () => {
      applySettings(await window.duck.setSettings({ cookieBrowser: b.id }))
      refreshCookies()
    }
  })))

  cookieUi.fileText.textContent = file || 'No file chosen'
  cookieUi.fileText.title = file || ''
  cookieUi.cacheText.textContent = cache.exists
    ? `${cache.count.toLocaleString()} saved · ${ago(cache.updated)}`
    : 'None saved yet'
  cookieUi.cacheText.title = found
  cookieUi.clearBtn.classList.toggle('hidden', !cache.exists)
}

async function runCookieGrab (force) {
  if (force) {
    const ok = await confirmDialog({
      title: 'Force cookie grab?',
      body: 'This tries every installed browser. If a browser is open and has locked its cookies, it will be closed so they can be read. Save your work in it first. Most browsers offer to restore your tabs when you reopen them.',
      confirmText: 'Close browsers and grab'
    })
    if (!ok) return
  }
  const buttons = [cookieUi.grabBtn, cookieUi.forceBtn, cookieUi.clearBtn]
  buttons.forEach(b => { b.disabled = true })
  cookieUi.log.classList.remove('hidden')
  cookieUi.log.textContent = 'Grabbing cookies…'
  try {
    const res = await window.duck.grabCookies({ allowClose: force })
    const names = Object.fromEntries(cookieStatus.browsers.map(b => [b.id, b.label]))
    const lines = res.tried.map(t => {
      const name = names[t.browser] || t.browser
      return t.ok
        ? `${name}: ${t.count.toLocaleString()} cookies saved${t.closed ? ' (it was closed first)' : ''}.`
        : `${t.message}${t.closed ? ' Closing it did not help.' : ''}`
    })
    if (!res.tried.length) lines.push(res.message || 'No supported browsers were found.')
    if (!res.ok) {
      const reasons = res.tried.map(t => t.reason)
      if (reasons.includes('locked') && !force) lines.push('Try "Force cookie grab" to close the browser that is locking its cookies.')
      if (reasons.includes('decrypt')) lines.push('Chrome, Edge and Brave now encrypt cookies so other apps can\'t read them. Firefox still works, or export a cookies.txt and use the File option.')
    }
    cookieUi.log.textContent = lines.join('\n')
    toast(res.ok ? 'Cookies saved.' : 'Could not grab cookies.', res.ok ? 'ok' : 'err')
  } catch (err) {
    cookieUi.log.textContent = cleanIpcError(err)
  } finally {
    buttons.forEach(b => { b.disabled = false })
    refreshCookies()
  }
}

function syncSettings () {
  const s = state.settings
  folderText.textContent = s.downloadDir
  folderText.title = s.downloadDir
  themeButtons.forEach((b, i) => {
    const active = ['default', 'amoled'][i] === s.theme
    b.classList.toggle('active', active)
    b.setAttribute('aria-checked', String(active))
  })
  languageSelect.value = s.subLanguage || 'system'
}

// ---- tools (yt-dlp, ffmpeg, Deno), auto update and rollback

const toolUi = { switchBtns: {} }

const TOOL_SOURCES = {
  managed: 'managed by this app',
  system: 'found on your PATH',
  bundled: 'bundled with the app',
  custom: 'custom path, never auto-updated'
}

const TOOL_IDS = [
  { id: 'ytdlp', name: 'yt-dlp' },
  { id: 'ffmpeg', name: 'ffmpeg' },
  { id: 'deno', name: 'Deno' }
]

const shortVersion = v => String(v || '').replace(/-(full|essentials)_build.*$/, '')

function buildToolRows (row) {
  toolUi.switchBtn = el('button', {
    class: 'switch',
    role: 'switch',
    'aria-label': 'Keep yt-dlp, ffmpeg and Deno up to date',
    'aria-checked': 'true',
    onClick: async () => {
      const on = toolUi.switchBtn.getAttribute('aria-checked') !== 'true'
      toolUi.switchBtn.setAttribute('aria-checked', String(on))
      await window.duck.setSettings({ autoUpdateTools: on })
      refreshTools()
    }
  }, el('span', { class: 'switch-thumb' }))
  toolUi.autoNote = el('p', {
    title: 'Checks at startup and every 12 hours. Updates install by themselves, a site change that breaks yt-dlp triggers an update and retry, and an update that fails the self-test is rolled back.'
  })

  // name | version | switch-version link, one line per tool
  toolUi.text = {}
  const list = el('div', { class: 'tool-list' })
  const purpose = {
    ytdlp: 'Downloads the videos',
    ffmpeg: 'Merges video and audio, and makes MP3s',
    deno: 'JavaScript runtime that YouTube needs'
  }
  for (const t of TOOL_IDS) {
    toolUi.text[t.id] = el('span', { class: 'tool-version', text: 'Checking…' })
    // Kept in the grid (invisible) when unused, so the columns line up.
    toolUi.switchBtns[t.id] = el('button', { class: 'link-btn invisible', onClick: () => runSwitch(t.id, t.name) }, el('span'))
    list.append(el('span', { class: 'tool-name', text: t.name, title: purpose[t.id] }), toolUi.text[t.id], toolUi.switchBtns[t.id])
  }

  toolUi.checkBtn = el('button', { class: 'btn', title: 'Install anything newer', onClick: () => runToolUpdate(false) }, icon('search'), 'Check now')
  toolUi.forceBtn = el('button', { class: 'btn', title: 'Download and reinstall the latest of all three (about 160 MB)', onClick: () => runToolUpdate(true) }, icon('refresh'), 'Force update')
  toolUi.testBtn = el('button', { class: 'btn', title: 'Look up a video to prove everything works', onClick: runSelfTest }, icon('check'), 'Self-test')
  toolUi.progress = el('p', { class: 'pre hidden' })
  toolUi.bar = el('div', { class: 'bar hidden' }, el('i'))

  return [
    row('Auto-update', toolUi.autoNote, toolUi.switchBtn),
    row('Versions', list),
    row('Maintenance', [toolUi.progress, toolUi.bar], [toolUi.checkBtn, toolUi.forceBtn, toolUi.testBtn])
  ]
}

const SOURCE_NOTE = { system: 'from PATH', bundled: 'bundled', custom: 'custom path' }

function describeTool (t, missingHint) {
  if (!t.version) return { text: 'Not installed', title: missingHint, ok: false }
  const parts = [shortVersion(t.version)]
  if (SOURCE_NOTE[t.source]) parts.push(SOURCE_NOTE[t.source])
  if (t.skip) parts.push(`skipping ${shortVersion(t.skip)}`)
  else if (t.updateAvailable) parts.push(`${t.latest} available`)
  return {
    text: parts.join(' · '),
    title: t.skip ? `${shortVersion(t.skip)} was rolled back, so it won't be installed until a newer release appears.` : '',
    ok: true
  }
}

async function refreshTools () {
  const st = await window.duck.toolStatus()
  const missing = {
    ytdlp: 'Use Check now to install it.',
    ffmpeg: 'Videos may not merge and MP3 will not work. Use Check now to install it.',
    deno: 'Some YouTube videos may fail. Use Check now to install it.'
  }
  for (const t of TOOL_IDS) {
    const info = st.tools[t.id]
    const d = describeTool(info, missing[t.id])
    const node = toolUi.text[t.id]
    node.textContent = d.text
    node.title = d.title
    node.className = 'tool-version' + (d.ok ? '' : ' tool-missing')

    const btn = toolUi.switchBtns[t.id]
    const prev = info.previous
    btn.classList.toggle('invisible', !prev)
    if (prev) {
      btn.lastChild.textContent = `${prev.older ? 'Go back to' : 'Switch to'} ${shortVersion(prev.version)}`
      btn.title = prev.older ? `Switch ${t.name} to the older version you had before` : `Switch ${t.name} to the newer version`
    }
  }
  toolUi.switchBtn.setAttribute('aria-checked', String(st.autoUpdate))
  toolUi.autoNote.textContent = st.autoUpdate
    ? (st.checkedAt ? `Last checked ${ago(st.checkedAt)}` : 'Not checked yet')
    : 'Off'
  setToolButtons(st.busy)
}

function setToolButtons (busy) {
  toolUi.checkBtn.disabled = busy
  toolUi.forceBtn.disabled = busy
  toolUi.testBtn.disabled = busy
  for (const btn of Object.values(toolUi.switchBtns)) btn.disabled = busy
}

function showToolProgress (e) {
  const names = { ytdlp: 'yt-dlp', ffmpeg: 'ffmpeg', deno: 'Deno' }
  if (e.tool === 'all') {
    setToolButtons(e.phase === 'start' || e.phase === 'selftest')
    if (e.phase === 'selftest') {
      toolUi.progress.classList.remove('hidden')
      toolUi.progress.textContent = 'Running the self-test…'
      toolUi.bar.classList.add('hidden')
    }
    if (e.phase === 'finish') {
      toolUi.bar.classList.add('hidden')
      refreshTools()
    }
    return
  }
  const name = names[e.tool]
  const text = {
    checking: `${name}: checking for a new version…`,
    downloading: `${name}: downloading ${Math.round(e.percent)}%`,
    verifying: `${name}: verifying the download…`,
    installing: `${name}: installing…`,
    done: `${name}: up to date.`,
    error: `${name}: ${e.message}`
  }[e.phase]
  if (!text) return
  toolUi.progress.classList.remove('hidden')
  toolUi.progress.textContent = text
  const showBar = e.phase === 'downloading'
  toolUi.bar.classList.toggle('hidden', !showBar)
  if (showBar) toolUi.bar.firstChild.style.width = `${e.percent}%`
}

async function runToolUpdate (force) {
  toolUi.progress.classList.remove('hidden')
  toolUi.progress.textContent = 'Starting…'
  setToolButtons(true)
  try {
    const out = await window.duck.updateTools({ force })
    if (out.busy) {
      toolUi.progress.textContent = 'An update is already running.'
      return
    }
    const lines = out.results.map(r => {
      switch (r.status) {
        case 'updated': return `${r.name}: updated to ${shortVersion(r.to)}.`
        case 'current': return `${r.name}: already up to date (${shortVersion(r.to)}).`
        case 'skipped': return `${r.name}: ${shortVersion(r.skipped)} was rolled back earlier, so it is skipped until a newer release.`
        case 'rolled-back': return `${r.name}: ${shortVersion(r.rolledBackFrom)} failed the self-test, so it went back to ${shortVersion(r.to)}.`
        case 'custom': return `${r.name}: uses a custom path, so it was not touched.`
        default: return `${r.name}: ${r.error}`
      }
    })
    toolUi.progress.textContent = lines.join('\n')
    const failed = out.results.some(r => r.status === 'error')
    const updated = out.results.some(r => r.status === 'updated')
    toast(failed ? 'Some updates failed.' : updated ? 'Tools updated.' : 'Everything is up to date.', failed ? 'err' : 'ok')
  } catch (err) {
    toolUi.progress.textContent = cleanIpcError(err)
  } finally {
    toolUi.bar.classList.add('hidden')
    refreshTools()
  }
}

async function runSwitch (id, name) {
  setToolButtons(true)
  try {
    const res = await window.duck.rollbackTool(id)
    toolUi.progress.classList.remove('hidden')
    toolUi.progress.textContent = `${name}: now on ${shortVersion(res.to)}.`
    toast(`${name} is now ${shortVersion(res.to)}.`)
  } catch (err) {
    toast(cleanIpcError(err), 'err')
  } finally {
    refreshTools()
  }
}

async function runSelfTest () {
  setToolButtons(true)
  toolUi.progress.classList.remove('hidden')
  toolUi.progress.textContent = 'Running the self-test…'
  try {
    const res = await window.duck.selfTest()
    toolUi.progress.textContent = res.ok
      ? `Self-test passed: looked up a YouTube video in ${(res.ms / 1000).toFixed(1)} s.`
      : `Self-test failed: ${res.error}`
    toast(res.ok ? 'Self-test passed.' : 'Self-test failed.', res.ok ? 'ok' : 'err')
  } catch (err) {
    toolUi.progress.textContent = cleanIpcError(err)
  } finally {
    refreshTools()
  }
}

// ------------------------------------------------------------------ boot

async function init () {
  applySettings(await window.duck.getSettings())
  buildShell()
  window.duck.systemLanguage().then(code => {
    languageSelect.options[0].textContent = `System default (${languageName(code)})`
  })
  syncSettings()
  window.duck.onJobUpdate(onJobUpdate)
  window.duck.onPasteAndLookUp(pasteAndLookUp)
  window.duck.onToolProgress(showToolProgress)
  window.duck.onToolsRolledBack(list => {
    toast(`${list.map(u => `${u.name} ${shortVersion(u.bad)}`).join(' and ')} failed a self-test, so the app went back to ${list.map(u => shortVersion(u.restored)).join(' and ')}.`, 'err')
  })
  window.duck.onToolsUpdated(list => {
    toast(`Updated ${list.map(u => `${u.name} to ${shortVersion(u.to)}`).join(' and ')}.`)
  })
  for (const job of await window.duck.listJobs()) onJobUpdate(job)
  syncJobsUi()
}

init()
