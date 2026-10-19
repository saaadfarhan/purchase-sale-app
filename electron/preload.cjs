const { contextBridge, ipcRenderer, webUtils } = require('electron')

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('office', Object.freeze({
  auth: {
    status: () => invoke('auth:status'),
    setup: (value) => invoke('auth:setup', value),
    login: (value) => invoke('auth:login', value),
    logout: () => invoke('auth:logout'),
  },
  app: {
    quit: () => invoke('app:quit'),
    menuAction: (action) => invoke('app:menu-action', action),
  },
  users: {
    list: () => invoke('users:list'),
    save: (value) => invoke('users:save', value),
    remove: (username) => invoke('users:remove', username),
  },
  audit: { list: () => invoke('audit:list') },
  database: {
    backup: () => invoke('database:backup'),
    exportData: () => invoke('database:export'),
    verify: () => invoke('database:verify'),
    openBackups: () => invoke('database:open-backups'),
  },
  ids: { next: (entity) => invoke('ids:next', entity) },
  dashboard: () => invoke('dashboard:get'),
  company: {
    get: () => invoke('company:get'),
    save: (value) => invoke('company:save', value),
    logo: () => invoke('company:logo'),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    save: (value) => invoke('accounts:save', value),
    remove: (code) => invoke('accounts:remove', code),
  },
  items: {
    list: () => invoke('items:list'),
    save: (value) => invoke('items:save', value),
    remove: (code) => invoke('items:remove', code),
  },
  banks: {
    list: () => invoke('banks:list'),
    save: (value) => invoke('banks:save', value),
    remove: (code) => invoke('banks:remove', code),
  },
  challans: {
    list: (type) => invoke('challans:list', type),
    post: (value) => invoke('challans:post', value),
    update: (value) => invoke('challans:update', value),
    remove: (number) => invoke('challans:remove', number),
  },
  cheques: {
    list: () => invoke('cheques:list'),
    save: (value) => invoke('cheques:save', value),
    remove: (number) => invoke('cheques:remove', number),
  },
  vouchers: {
    list: () => invoke('vouchers:list'),
    save: (value) => invoke('vouchers:save', value),
    remove: (number) => invoke('vouchers:remove', number),
  },
  stock: {
    locations: () => invoke('stock:locations'),
    quantity: (itemCode, location) => invoke('stock:quantity', { itemCode, location }),
    types: () => invoke('stock:types'),
    saveType: (value) => invoke('stock-types:save', value),
    removeType: (code) => invoke('stock-types:remove', code),
    movements: () => invoke('stock:movements'),
    openings: () => invoke('stock:openings'),
    addOpening: (value) => invoke('stock:opening:add', value),
    transfer: (value) => invoke('stock:transfer', value),
  },
}))
