const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const selfsigned = require('selfsigned')
const { openOfficeDatabase } = require('./database.cjs')
const { contentSecurityPolicy } = require('./security.cjs')
const { createOfficeRpcServer } = require('./office-rpc.cjs')
const { createOfficeRemoteClient } = require('./office-remote.cjs')

app.setName('PurchaseSaleOffice')

let mainWindow
let officeStore
let activeSession = null
let officeServer = null
let remoteClient = null
let connectionConfig = null
const operationHandlers = new Map()
const localOnlyChannels = new Set(['app:quit', 'app:menu-action'])
let operationQueue = Promise.resolve()
const developmentUrl = process.env.ELECTRON_START_URL

function getDatabasePath() {
  // Match the existing Windows Java installation path so current SQLite data stays visible.
  const root = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'PurchaseSaleOffice')
    : app.getPath('userData')
  return path.join(root, 'data', 'purchase-sale.sqlite')
}

function getConnectionConfigPath() {
  return path.join(app.getPath('userData'), 'office-connection.json')
}

function getServerCertificatePaths() {
  const directory = path.join(app.getPath('userData'), 'office-server-certificate')
  return { directory, key: path.join(directory, 'server-key.pem'), cert: path.join(directory, 'server-cert.pem') }
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces()).flatMap((entries) => entries || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

async function loadRemoteConnection() {
  const configPath = getConnectionConfigPath()
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
    remoteClient = createOfficeRemoteClient(config)
    connectionConfig = { url: config.url, fingerprint: config.fingerprint }
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw new Error(`Saved office server connection is invalid: ${error.message}`)
  }
}

async function createServerCertificate() {
  const paths = getServerCertificatePaths()
  await fs.mkdir(paths.directory, { recursive: true })
  try {
    const [key, cert] = await Promise.all([fs.readFile(paths.key, 'utf8'), fs.readFile(paths.cert, 'utf8')])
    return { key, cert }
  } catch {
    const generated = await selfsigned.generate([{ name: 'commonName', value: 'Purchase Sale Office' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
      ],
    })
    await fs.writeFile(paths.key, generated.private, { mode: 0o600, flag: 'wx' }).catch(async (error) => {
      if (error.code !== 'EEXIST') throw error
      await fs.writeFile(paths.key, generated.private, { mode: 0o600 })
    })
    await fs.writeFile(paths.cert, generated.cert, { mode: 0o644 })
    return { key: generated.private, cert: generated.cert }
  }
}

async function startOfficeServer() {
  if (!officeStore || remoteClient) throw new Error('Only the computer with the local office database can host shared access')
  if (!activeSession?.permissions.includes('User Rights')) throw new Error('Only an administrator can start the office server')
  if (officeServer) return officeServer.info

  const tls = await createServerCertificate()
  const certificate = new crypto.X509Certificate(tls.cert)
  const fingerprint = crypto.createHash('sha256').update(certificate.raw).digest('hex').match(/.{2}/g).join(':').toUpperCase()
  const addresses = getLanAddresses()
  const server = createOfficeRpcServer({
    tls,
    host: '0.0.0.0',
    port: 48391,
    permissionFor: (channel, args) => {
      if (localOnlyChannels.has(channel)) return undefined
      return operationHandlers.get(channel)?.permission
    },
    refreshSession: (session) => officeStore.getUserSession(session.username),
    dispatch: (channel, args, session) => invokeOfficeOperation(channel, args, session),
  })
  await server.listen()
  const info = { urls: addresses.map((address) => `https://${address}:48391`), fingerprint, port: 48391 }
  officeServer = { server, info }
  return info
}

async function stopOfficeServer() {
  if (!officeServer) return
  const current = officeServer
  officeServer = null
  await current.server.close()
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted renderer')
  const url = event.senderFrame?.url || ''
  const trusted = developmentUrl
    ? url.startsWith(developmentUrl)
    : url.startsWith(pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href)
  if (!trusted) throw new Error('IPC request rejected from an unexpected page')
}

function registerHandler(channel, handler, permission = null) {
  operationHandlers.set(channel, { handler, permission })
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    if (remoteClient && !localOnlyChannels.has(channel)) {
      const result = await remoteClient.invoke(channel, args)
      if (channel === 'auth:setup' || channel === 'auth:login') activeSession = result
      if (channel === 'auth:logout') activeSession = null
      return result
    }
    const result = await invokeOfficeOperation(channel, args, activeSession)
    if (channel === 'auth:setup' || channel === 'auth:login') {
      activeSession = result
      officeStore?.setAuditActor(result?.username || 'system')
    }
    if (channel === 'auth:logout') {
      activeSession = null
      officeStore?.setAuditActor('system')
    }
    return result
  })
}

function invokeOfficeOperation(channel, args, session) {
  const task = async () => {
    const definition = operationHandlers.get(channel)
    if (!definition) throw new Error('Unsupported office operation')
    if (!channel.startsWith('auth:') && channel !== 'app:quit') {
      if (!session) throw new Error('Please sign in to continue')
      const requiredPermission = typeof definition.permission === 'function' ? definition.permission(...args) : definition.permission
      if (requiredPermission && !(Array.isArray(requiredPermission)
        ? requiredPermission.some((entry) => session.permissions.includes(entry))
        : session.permissions.includes(requiredPermission))) throw new Error('Your account does not have permission for this operation')
    }

    const previousSession = activeSession
    activeSession = session
    officeStore?.setAuditActor(session?.username || 'system')
    try {
      const value = await definition.handler(...args)
      if (channel === 'auth:status') return { ...value, session: session || null }
      return value
    } finally {
      activeSession = previousSession
      officeStore?.setAuditActor(previousSession?.username || 'system')
    }
  }
  const result = operationQueue.then(task, task)
  operationQueue = result.catch(() => undefined)
  return result
}

function registerIpc() {
  registerHandler('auth:status', () => ({ hasUsers: officeStore.hasUsers(), hasCompanyProfile: officeStore.hasCompanyProfile(), session: activeSession }))
  registerHandler('auth:setup', (input) => { activeSession = officeStore.createFirstUser(input); return activeSession })
  registerHandler('auth:login', (input) => { activeSession = officeStore.authenticate(input.username, input.password); return activeSession })
  registerHandler('auth:logout', () => { officeStore.setCurrentUser(activeSession?.username); activeSession = null })
  registerHandler('app:quit', () => app.quit())
  registerHandler('app:menu-action', (action) => {
    if (!mainWindow) return
    const contents = mainWindow.webContents
    switch (action) {
      case 'reload': contents.reload(); break
      case 'forceReload': contents.reloadIgnoringCache(); break
      case 'devTools': contents.toggleDevTools(); break
      case 'zoomIn': contents.setZoomLevel(contents.getZoomLevel() + 0.5); break
      case 'zoomOut': contents.setZoomLevel(contents.getZoomLevel() - 0.5); break
      case 'resetZoom': contents.setZoomLevel(0); break
      case 'minimize': mainWindow.minimize(); break
      case 'close': mainWindow.close(); break
      case 'fullscreen': mainWindow.setFullScreen(!mainWindow.isFullScreen()); break
      case 'undo': contents.undo(); break
      case 'redo': contents.redo(); break
      case 'cut': contents.cut(); break
      case 'copy': contents.copy(); break
      case 'paste': contents.paste(); break
      case 'selectAll': contents.selectAll(); break
      default: throw new Error('Unsupported application menu action')
    }
  })
  registerHandler('ids:next', (entity) => officeStore.nextId(String(entity)), (entity) => ({ account: 'Chart of Accounts', item: 'Items', bank: 'Banks', purchaseChallan: 'Purchase Challans', saleChallan: 'Sale Challans', cheque: 'Cheque Detail', transfer: 'Transfer', voucher: ['Voucher', 'Journal Voucher', 'Payment / Receipt'] })[entity] || null)
  registerHandler('dashboard:get', () => officeStore.getDashboard(), 'Overview')
  registerHandler('company:get', () => officeStore.getCompanyProfile(), ['Company Profile', 'Purchase Challans', 'Sale Challans', 'Voucher', 'Journal Voucher', 'Payment / Receipt', 'Reports'])
  registerHandler('company:save', (value) => officeStore.saveCompanyProfile(value), 'User Rights')
  registerHandler('company:logo', async () => {
    const logoPath = officeStore.getCompanyProfile().logoPath
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(logoPath).toLowerCase()]
    if (!mime || !path.isAbsolute(logoPath)) return null
    try {
      const image = await fs.readFile(logoPath)
      if (image.length > 4 * 1024 * 1024) return null
      return `data:${mime};base64,${image.toString('base64')}`
    } catch { return null }
  }, ['Company Profile', 'Purchase Challans', 'Sale Challans', 'Voucher', 'Journal Voucher', 'Payment / Receipt', 'Reports'])
  registerHandler('accounts:list', () => officeStore.listAccounts(), ['Chart of Accounts', 'Purchase Challans', 'Sale Challans', 'Voucher', 'Journal Voucher', 'Payment / Receipt', 'Search Payment', 'Reports'])
  registerHandler('accounts:save', (value) => officeStore.saveAccount(value), 'Chart of Accounts')
  registerHandler('accounts:remove', (code) => officeStore.deleteAccount(String(code)), 'Chart of Accounts')
  registerHandler('items:list', () => officeStore.listItems(), ['Items', 'Purchase Challans', 'Sale Challans', 'Reports'])
  registerHandler('items:save', (value) => officeStore.saveItem(value), 'Items')
  registerHandler('items:remove', (code) => officeStore.deleteItem(String(code)), 'Items')
  registerHandler('banks:list', () => officeStore.listBanks(), ['Banks', 'Cheque Detail'])
  registerHandler('banks:save', (value) => officeStore.saveBank(value), 'Banks')
  registerHandler('banks:remove', (code) => officeStore.deleteBank(String(code)), 'Banks')
  registerHandler('challans:list', (type) => officeStore.listChallans(type ? String(type) : null), (type) => type === 'SALE' ? ['Sale Challans', 'Reports'] : type === 'PURCHASE' ? ['Purchase Challans', 'Reports'] : ['Purchase Challans', 'Sale Challans', 'Reports'])
  registerHandler('challans:post', (value) => officeStore.postChallan(value), (value) => value?.type === 'SALE' ? 'Sale Challans' : 'Purchase Challans')
  registerHandler('challans:update', (value) => officeStore.updateChallan(value), (value) => value?.type === 'SALE' ? 'Sale Challans' : 'Purchase Challans')
  registerHandler('challans:remove', (number) => officeStore.deleteChallan(String(number)), (number) => officeStore.getChallanType(String(number)) === 'SALE' ? 'Sale Challans' : 'Purchase Challans')
  registerHandler('cheques:list', () => officeStore.listCheques(), ['Cheque Detail', 'Reports'])
  registerHandler('cheques:save', (value) => officeStore.saveCheque(value), 'Cheque Detail')
  registerHandler('cheques:remove', (number) => officeStore.deleteCheque(String(number)), 'Cheque Detail')
  registerHandler('vouchers:list', () => {
    if (activeSession.permissions.includes('Reports')) return officeStore.listVouchers()
    const types = []
    if (activeSession.permissions.includes('Voucher')) types.push('VOUCHER')
    if (activeSession.permissions.includes('Journal Voucher')) types.push('JOURNAL VOUCHER')
    if (activeSession.permissions.includes('Payment / Receipt') || activeSession.permissions.includes('Search Payment')) types.push('PAYMENT', 'RECEIPT')
    return officeStore.listVouchers(types)
  }, ['Voucher', 'Journal Voucher', 'Search Payment', 'Payment / Receipt', 'Reports'])
  registerHandler('vouchers:save', (value) => officeStore.saveVoucher(value), (value) => ({ VOUCHER: 'Voucher', 'JOURNAL VOUCHER': 'Journal Voucher', PAYMENT: 'Payment / Receipt', RECEIPT: 'Payment / Receipt' })[String(value?.type || 'VOUCHER').toUpperCase()] || 'Voucher')
  registerHandler('vouchers:remove', (number) => officeStore.deleteVoucher(String(number)), (number) => ({ VOUCHER: 'Voucher', 'JOURNAL VOUCHER': 'Journal Voucher', PAYMENT: 'Payment / Receipt', RECEIPT: 'Payment / Receipt' })[officeStore.getVoucherType(String(number))] || null)
  registerHandler('stock:locations', () => officeStore.listLocations(), ['Purchase Challans', 'Sale Challans', 'Item Opening Balances', 'Transfer', 'Reports'])
  registerHandler('stock:quantity', ({ itemCode, location }) => officeStore.getStock(String(itemCode), String(location)), ['Items', 'Transfer'])
  registerHandler('stock:types', () => officeStore.listStockTypes(), ['Items', 'Purchase Challans', 'Sale Challans', 'Stock Types'])
  registerHandler('stock-types:save', (value) => officeStore.saveStockType(value), 'Stock Types')
  registerHandler('stock-types:remove', (code) => officeStore.deleteStockType(String(code)), 'Stock Types')
  registerHandler('stock:movements', () => officeStore.listStockMovements(), ['Reports', 'Transfer', 'Item Opening Balances'])
  registerHandler('stock:openings', () => officeStore.listOpeningBalances(), 'Item Opening Balances')
  registerHandler('stock:opening:add', (value) => officeStore.addOpeningBalance(value), 'Item Opening Balances')
  registerHandler('stock:transfer', (value) => officeStore.transferStock(value), 'Transfer')
  registerHandler('users:list', () => officeStore.listUsers(), 'User Rights')
  registerHandler('users:save', (value) => officeStore.saveUser(value), 'User Rights')
  registerHandler('users:remove', (username) => officeStore.deleteUser(String(username)), 'User Rights')
  registerHandler('audit:list', () => officeStore.auditEvents(), 'Audit Log')
  registerHandler('database:backup', async () => {
    const backupDirectory = path.join(path.dirname(getDatabasePath()), 'backups')
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const target = path.join(backupDirectory, `purchase-sale-${timestamp}.sqlite`)
    return { ...await officeStore.backupTo(target), path: target }
  }, 'Database Tools')
  registerHandler('database:export', async () => {
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Export office data',
      defaultPath: path.join(app.getPath('documents'), `purchase-sale-export-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON data export', extensions: ['json'] }],
    })
    if (choice.canceled || !choice.filePath) return { canceled: true }
    const payload = officeStore.exportData()
    await fs.writeFile(choice.filePath, `${JSON.stringify(payload, null, 2)}\n`)
    return { canceled: false, path: choice.filePath, bytes: (await fs.stat(choice.filePath)).size }
  }, 'Database Tools')
  registerHandler('database:verify', () => officeStore.verifyDatabase(), 'Database Tools')
  registerHandler('database:open-backups', async () => {
    const directory = path.join(path.dirname(getDatabasePath()), 'backups')
    await fs.mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) throw new Error(`Could not open backup folder: ${error}`)
  }, 'Database Tools')

  ipcMain.handle('connection:get', (event) => {
    assertTrustedSender(event)
    return { mode: remoteClient ? 'remote' : 'local', ...(connectionConfig || {}) }
  })
  ipcMain.handle('connection:configure-remote', async (event, config) => {
    assertTrustedSender(event)
    const candidate = { url: String(config?.url || '').trim(), fingerprint: String(config?.fingerprint || '').trim() }
    const client = createOfficeRemoteClient(candidate)
    await fs.mkdir(path.dirname(getConnectionConfigPath()), { recursive: true })
    const temporary = `${getConnectionConfigPath()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(candidate), { mode: 0o600 })
    await fs.rename(temporary, getConnectionConfigPath())
    remoteClient = client
    connectionConfig = candidate
    activeSession = null
    return { mode: 'remote', ...candidate }
  })
  ipcMain.handle('connection:use-local', async (event) => {
    assertTrustedSender(event)
    remoteClient = null
    connectionConfig = null
    await fs.rm(getConnectionConfigPath(), { force: true })
    if (!officeStore) officeStore = openOfficeDatabase(getDatabasePath())
    activeSession = null
    return { mode: 'local' }
  })
  ipcMain.handle('server:start', async (event) => {
    assertTrustedSender(event)
    return startOfficeServer()
  })
  ipcMain.handle('server:stop', async (event) => {
    assertTrustedSender(event)
    if (!activeSession?.permissions.includes('User Rights')) throw new Error('Only an administrator can stop the office server')
    await stopOfficeServer()
  })
  ipcMain.handle('server:status', (event) => {
    assertTrustedSender(event)
    return officeServer?.info ?? null
  })
}

function setContentSecurityPolicy() {
  // Vite injects an inline React Refresh preamble; this exception is dev-only.
  const csp = contentSecurityPolicy(developmentUrl)
  const filter = { urls: ['http://127.0.0.1:5173/*', 'file:///*'] }
  const ses = require('electron').session.defaultSession
  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Purchase Sale Office',
    backgroundColor: '#f4f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const trusted = developmentUrl
      ? target.startsWith(developmentUrl)
      : target.startsWith(pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href)
    if (!trusted) event.preventDefault()
  })
  if (developmentUrl) mainWindow.loadURL(developmentUrl)
  else mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const useRemote = await loadRemoteConnection()
  if (!useRemote) officeStore = openOfficeDatabase(getDatabasePath())
  setContentSecurityPolicy()
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch((error) => {
  dialog.showErrorBox('Cannot start Purchase Sale Office', error instanceof Error ? error.message : 'Startup failed')
  app.quit()
})

app.on('before-quit', (event) => {
  if (officeServer) {
    event.preventDefault()
    void stopOfficeServer().finally(() => { officeStore?.close(); app.quit() })
  } else officeStore?.close()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
