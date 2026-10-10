const { contextBridge, ipcRenderer } = require('electron')

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('duck', {
  getSettings: () => call('settings:get'),
  systemLanguage: () => call('app:systemLanguage'),
  setSettings: patch => call('settings:set', patch),
  pickFolder: () => call('settings:pickFolder'),
  readClipboard: () => call('clipboard:read'),
  fetchInfo: url => call('info:fetch', url),
  listJobs: () => call('jobs:list'),
  addJob: opts => call('jobs:add', opts),
  cancelJob: id => call('jobs:cancel', id),
  removeJob: id => call('jobs:remove', id),
  clearFinished: () => call('jobs:clearFinished'),
  showFile: id => call('shell:showFile', id),
  openFolder: () => call('shell:openFolder'),
  cookieStatus: () => call('cookies:status'),
  grabCookies: opts => call('cookies:grab', opts),
  clearCookies: () => call('cookies:clear'),
  pickCookieFile: () => call('cookies:pickFile'),
  toolStatus: () => call('tools:status'),
  updateTools: opts => call('tools:update', opts),
  rollbackTool: id => call('tools:rollback', id),
  selfTest: () => call('tools:selfTest'),
  onToolProgress: cb => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('tools:progress', listener)
    return () => ipcRenderer.removeListener('tools:progress', listener)
  },
  onToolsUpdated: cb => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('tools:updated', listener)
    return () => ipcRenderer.removeListener('tools:updated', listener)
  },
  onToolsRolledBack: cb => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('tools:rolledback', listener)
    return () => ipcRenderer.removeListener('tools:rolledback', listener)
  },
  onPasteAndLookUp: cb => {
    const listener = () => cb()
    ipcRenderer.on('ui:pasteAndLookUp', listener)
    return () => ipcRenderer.removeListener('ui:pasteAndLookUp', listener)
  },
  onJobUpdate: cb => {
    const listener = (_e, job) => cb(job)
    ipcRenderer.on('jobs:update', listener)
    return () => ipcRenderer.removeListener('jobs:update', listener)
  }
})
