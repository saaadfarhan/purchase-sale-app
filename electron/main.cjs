const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const { openOfficeDatabase } = require('./database.cjs')
const { contentSecurityPolicy } = require('./security.cjs')

app.setName('PurchaseSaleOffice')

let mainWindow
let officeStore
let activeSession = null
const developmentUrl = process.env.ELECTRON_START_URL

function getDatabasePath() {
  // Match the existing Windows Java installation path so current SQLite data stays visible.
  const root = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'PurchaseSaleOffice')
    : app.getPath('userData')
  return path.join(root, 'data', 'purchase-sale.sqlite')
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
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event)
    if (!channel.startsWith('auth:') && channel !== 'app:quit') {
      if (!activeSession) throw new Error('Please sign in to continue')
      const requiredPermission = typeof permission === 'function' ? permission(...args) : permission
      if (requiredPermission && !(Array.isArray(requiredPermission)
        ? requiredPermission.some((entry) => activeSession.permissions.includes(entry))
        : activeSession.permissions.includes(requiredPermission))) throw new Error('Your account does not have permission for this page')
    }
    return handler(...args)
  })
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  officeStore = openOfficeDatabase(getDatabasePath())
  setContentSecurityPolicy()
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => officeStore?.close())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
