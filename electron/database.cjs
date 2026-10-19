const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')

function openOfficeDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  initializeSchema(db)
  return createOfficeStore(db)
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, address TEXT NOT NULL,
      phone TEXT NOT NULL, fiscal_year TEXT NOT NULL, logo_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, permissions TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      code TEXT PRIMARY KEY, description TEXT NOT NULL, parent_code TEXT,
      opening_balance NUMERIC NOT NULL DEFAULT 0,
      FOREIGN KEY (parent_code) REFERENCES accounts(code)
    );
    CREATE TABLE IF NOT EXISTS items (
      code TEXT PRIMARY KEY, description TEXT NOT NULL, unit TEXT NOT NULL,
      sale_rate NUMERIC NOT NULL, purchase_rate NUMERIC NOT NULL, stock_type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_types (
      code TEXT PRIMARY KEY, description TEXT NOT NULL
    );
    INSERT OR IGNORE INTO stock_types(code, description) VALUES ('REG', 'Regular');
    INSERT OR IGNORE INTO stock_types(code, description) VALUES ('SER', 'Service');
    CREATE TABLE IF NOT EXISTS banks (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, account_number TEXT,
      opening_balance NUMERIC NOT NULL DEFAULT 0, address TEXT, phone TEXT
    );
    CREATE TABLE IF NOT EXISTS cheques (
      number TEXT PRIMARY KEY, bank_code TEXT NOT NULL, cheque_date TEXT NOT NULL,
      party TEXT NOT NULL, amount NUMERIC NOT NULL, status TEXT NOT NULL, manual_id TEXT,
      FOREIGN KEY (bank_code) REFERENCES banks(code)
    );
    CREATE TABLE IF NOT EXISTS cheque_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cheque_number TEXT NOT NULL,
      status TEXT NOT NULL, changed_at TEXT NOT NULL,
      FOREIGN KEY (cheque_number) REFERENCES cheques(number)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_time TEXT NOT NULL,
      username TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challans (
      number TEXT PRIMARY KEY, type TEXT NOT NULL, date TEXT NOT NULL, party TEXT NOT NULL,
      location TEXT NOT NULL, total NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challan_lines (
      challan_number TEXT NOT NULL, line_number INTEGER NOT NULL, item_code TEXT NOT NULL,
      quantity NUMERIC NOT NULL, rate NUMERIC NOT NULL, amount NUMERIC NOT NULL,
      PRIMARY KEY (challan_number, line_number),
      FOREIGN KEY (challan_number) REFERENCES challans(number),
      FOREIGN KEY (item_code) REFERENCES items(code)
    );
    CREATE TABLE IF NOT EXISTS vouchers (
      number TEXT PRIMARY KEY, date TEXT NOT NULL, narration TEXT, reference TEXT,
      voucher_type TEXT NOT NULL DEFAULT 'VOUCHER'
    );
    CREATE TABLE IF NOT EXISTS voucher_lines (
      voucher_number TEXT NOT NULL, line_number INTEGER NOT NULL, account_code TEXT NOT NULL,
      debit NUMERIC NOT NULL, credit NUMERIC NOT NULL,
      PRIMARY KEY (voucher_number, line_number),
      FOREIGN KEY (voucher_number) REFERENCES vouchers(number),
      FOREIGN KEY (account_code) REFERENCES accounts(code)
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, document TEXT NOT NULL,
      type TEXT NOT NULL, item_code TEXT NOT NULL, location TEXT NOT NULL,
      quantity NUMERIC NOT NULL, rate NUMERIC NOT NULL, amount NUMERIC NOT NULL,
      FOREIGN KEY (item_code) REFERENCES items(code)
    );
    CREATE TABLE IF NOT EXISTS stock_transfers (
      transfer_id TEXT PRIMARY KEY, transfer_date TEXT NOT NULL, item_code TEXT NOT NULL,
      from_location TEXT NOT NULL, to_location TEXT NOT NULL, quantity NUMERIC NOT NULL,
      FOREIGN KEY (item_code) REFERENCES items(code)
    );
    CREATE TABLE IF NOT EXISTS sync_operations (
      operation_id TEXT PRIMARY KEY, origin_device TEXT NOT NULL, sequence_number INTEGER NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation_type TEXT NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL, content_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      conflict_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      local_operation_id TEXT NOT NULL, remote_operation_id TEXT NOT NULL, status TEXT NOT NULL,
      local_payload TEXT NOT NULL, remote_payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS id_sequences (entity TEXT PRIMARY KEY, last_number INTEGER NOT NULL);
  `)

  const columns = db.prepare('PRAGMA table_info(cheques)').all().map((column) => column.name)
  if (!columns.includes('manual_id')) db.exec('ALTER TABLE cheques ADD COLUMN manual_id TEXT')
  const voucherColumns = db.prepare('PRAGMA table_info(vouchers)').all().map((column) => column.name)
  if (!voucherColumns.includes('voucher_type')) db.exec("ALTER TABLE vouchers ADD COLUMN voucher_type TEXT NOT NULL DEFAULT 'VOUCHER'")
}

function createOfficeStore(db) {
  const findAccount = db.prepare('SELECT code, description, parent_code AS parentCode, opening_balance AS openingBalance FROM accounts WHERE code = ?')
  const audit = db.prepare('INSERT INTO audit_events(event_time, username, action, details) VALUES (?, ?, ?, ?)')
  const now = () => new Date().toISOString()
  let currentUser = 'system'
  const recordAudit = (action, details) => audit.run(now(), currentUser, action, details)

  function listUsers() {
    return db.prepare('SELECT username, permissions FROM users ORDER BY username').all().map((row) => ({
      username: row.username,
      permissions: normalizePermissions(row.permissions ? row.permissions.split('\u001f').filter(Boolean) : []),
    }))
  }

  function getUserSession(username) {
    const user = db.prepare('SELECT username, permissions FROM users WHERE username=?').get(String(username || '').trim())
    if (!user) return null
    return {
      username: user.username,
      permissions: normalizePermissions(user.permissions ? user.permissions.split('\u001f').filter(Boolean) : []),
    }
  }

  function saveUser(input) {
    const username = required(input.username, 'User name')
    if (username.length > 80) throw new Error('User name must be 80 characters or fewer')
    const existing = db.prepare('SELECT password_hash FROM users WHERE username=?').get(username)
    const password = String(input.password || '')
    if (!existing && password.length < 8) throw new Error('New user passwords must be at least 8 characters')
    if (password && password.length < 8) throw new Error('Passwords must be at least 8 characters')
    const permissions = normalizePermissions((input.permissions || []).map(String))
    if (permissions.length <= 2) throw new Error('Select at least one page permission')
    if (existing && username === currentUser) {
      const currentPermissions = new Set(listUsers().find((user) => user.username === username)?.permissions || [])
      // User Rights is the app's administrator capability. Permit an
      // administrator to repair their own page access, but not an operator.
      if (!currentPermissions.has('User Rights') && permissions.some((permission) => !currentPermissions.has(permission))) {
        throw new Error('You cannot grant yourself additional page rights')
      }
    }
    if (existing && listUsers().find((user) => user.username === username)?.permissions.includes('User Rights') && !permissions.includes('User Rights')) {
      const anotherManager = db.prepare("SELECT 1 FROM users WHERE username<>? AND instr(permissions, 'User Rights') > 0 LIMIT 1").get(username)
      if (!anotherManager) throw new Error('At least one user must retain User Rights access')
    }
    const hash = password ? hashPassword(password) : existing?.password_hash
    db.prepare('INSERT INTO users(username, password_hash, permissions) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, permissions=excluded.permissions')
      .run(username, hash, permissions.join('\u001f'))
    recordAudit(existing ? 'USER_UPDATE' : 'USER_SAVE', username)
    return listUsers().find((user) => user.username === username)
  }

  function deleteUser(username) {
    if (username === currentUser) throw new Error('You cannot delete the signed-in user')
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
    if (userCount <= 1) throw new Error('The last user account cannot be deleted')
    const target = listUsers().find((user) => user.username === username)
    if (target?.permissions.includes('User Rights')) {
      const anotherManager = db.prepare("SELECT 1 FROM users WHERE username<>? AND instr(permissions, 'User Rights') > 0 LIMIT 1").get(username)
      if (!anotherManager) throw new Error('At least one user must retain User Rights access')
    }
    const result = db.prepare('DELETE FROM users WHERE username=?').run(username)
    if (!result.changes) throw new Error('User does not exist')
    recordAudit('USER_DELETE', username)
  }

  function authenticate(username, password) {
    const user = db.prepare('SELECT username, password_hash, permissions FROM users WHERE username=?').get(String(username).trim())
    if (!user || !verifyPassword(String(password), user.password_hash)) throw new Error('User name or password is incorrect')
    currentUser = user.username
    recordAudit('LOGIN', user.username)
    return { username: user.username, permissions: normalizePermissions(user.permissions ? user.permissions.split('\u001f').filter(Boolean) : []) }
  }

  function createFirstUser(input) {
    if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new Error('A user account already exists')
    const username = required(input.username, 'User name')
    const password = String(input.password || '')
    if (password.length < 8) throw new Error('Password must be at least 8 characters')
    const permissions = ['Overview', 'Company Profile', 'Chart of Accounts', 'Items', 'Banks', 'Stock Types', 'Item Opening Balances', 'Transfer', 'Cheque Detail', 'Purchase Challans', 'Sale Challans', 'Voucher', 'Journal Voucher', 'Search Payment', 'Payment / Receipt', 'Reports', 'User Rights', 'Audit Log', 'Database Tools', 'Manual']
    db.prepare('INSERT INTO users(username, password_hash, permissions) VALUES (?, ?, ?)').run(username, hashPassword(password), permissions.join('\u001f'))
    currentUser = username
    recordAudit('INITIAL_ADMIN_CREATED', username)
    return { username, permissions: normalizePermissions(permissions) }
  }

  function setCurrentUser(username) {
    currentUser = username || 'system'
    if (username) recordAudit('LOGOUT', username)
  }

  function setAuditActor(username) {
    currentUser = username || 'system'
  }

  function auditEvents() {
    return db.prepare('SELECT event_time AS eventTime, username, action, details FROM audit_events ORDER BY id DESC LIMIT 1000').all()
  }

  async function backupTo(target) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await db.backup(target)
    recordAudit('DATABASE_BACKUP', path.basename(target))
    return { fileName: path.basename(target), bytes: fs.statSync(target).size }
  }

  function exportData() {
    recordAudit('DATABASE_EXPORT', 'Business data JSON export')
    const tables = ['company_profile', 'accounts', 'items', 'stock_types', 'banks', 'cheques', 'cheque_status_history', 'challans', 'challan_lines', 'vouchers', 'voucher_lines', 'stock_movements', 'stock_transfers', 'audit_events']
    const data = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]))
    return { format: 'purchase-sale-office-data', version: 1, exportedAt: now(), data }
  }

  function verifyDatabase() {
    const integrity = db.pragma('integrity_check').map((row) => row.integrity_check)
    const foreignKeyViolations = db.pragma('foreign_key_check')
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
    const tableCounts = Object.fromEntries(tableNames.map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count]))
    const result = { ok: integrity.length === 1 && integrity[0] === 'ok' && foreignKeyViolations.length === 0, integrity, foreignKeyViolations, tableCounts, checkedAt: now() }
    recordAudit('DATABASE_VERIFY', result.ok ? 'Integrity and foreign keys passed' : 'Integrity or foreign-key errors found')
    return result
  }

  function getCompanyProfile() {
    return db.prepare('SELECT name, address, phone, fiscal_year AS fiscalYear, logo_path AS logoPath FROM company_profile WHERE id=1').get()
      || { name: '', address: '', phone: '', fiscalYear: '', logoPath: '' }
  }

  function hasCompanyProfile() {
    return Boolean(db.prepare("SELECT 1 FROM company_profile WHERE id=1 AND trim(name)<>''").get())
  }

  function saveCompanyProfile(input) {
    const isUpdate = hasCompanyProfile()
    const profile = {
      name: required(input.name, 'Company name'), address: String(input.address || '').trim(),
      phone: String(input.phone || '').trim(), fiscalYear: String(input.fiscalYear || '').trim(),
      logoPath: String(input.logoPath || '').trim(),
    }
    db.prepare(`INSERT INTO company_profile(id, name, address, phone, fiscal_year, logo_path)
      VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
      address=excluded.address, phone=excluded.phone, fiscal_year=excluded.fiscal_year,
      logo_path=excluded.logo_path`).run(profile.name, profile.address, profile.phone, profile.fiscalYear, profile.logoPath)
    recordAudit(isUpdate ? 'COMPANY_PROFILE_UPDATE' : 'COMPANY_PROFILE_SAVE', profile.name)
    return profile
  }

  const idDefinitions = {
    account: { table: 'accounts', column: 'code', prefix: 'ACC' },
    item: { table: 'items', column: 'code', prefix: 'ITM' },
    bank: { table: 'banks', column: 'code', prefix: 'BNK' },
    purchaseChallan: { table: 'challans', column: 'number', prefix: 'PUR', type: 'PURCHASE' },
    saleChallan: { table: 'challans', column: 'number', prefix: 'SAL', type: 'SALE' },
    cheque: { table: 'cheques', column: 'number', prefix: 'CHQ' },
    transfer: { table: 'stock_transfers', column: 'transfer_id', prefix: 'TRF' },
    voucher: { table: 'vouchers', column: 'number', prefix: 'VCH' },
  }
  function allocateOfficeId(entity) {
    const definition = idDefinitions[entity]
    if (!definition) throw new Error('Unknown ID type')
    const existing = db.prepare(`SELECT ${definition.column} AS value FROM ${definition.table} WHERE ${definition.column} LIKE ?`).all(`${definition.prefix}-%`)
    const maxExisting = existing.reduce((max, row) => {
      const match = String(row.value).match(new RegExp(`^${definition.prefix}-(\\d+)$`))
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const stored = db.prepare('SELECT last_number FROM id_sequences WHERE entity=?').get(entity)?.last_number ?? 0
    const next = Math.max(maxExisting, stored) + 1
    db.prepare('INSERT INTO id_sequences(entity, last_number) VALUES (?, ?) ON CONFLICT(entity) DO UPDATE SET last_number=excluded.last_number').run(entity, next)
    return `${definition.prefix}-${String(next).padStart(5, '0')}`
  }
  const nextOfficeId = db.transaction(allocateOfficeId)

  function listAccounts() {
    return db.prepare('SELECT code, description, parent_code AS parentCode, opening_balance AS openingBalance FROM accounts ORDER BY code').all()
  }

  function saveAccount(input) {
    const code = required(input.code, 'Account code')
    const description = required(input.description, 'Description')
    const parentCode = input.parentCode ? String(input.parentCode).trim() : null
    if (parentCode === code) throw new Error('An account cannot be its own parent')
    if (parentCode && !findAccount.get(parentCode)) throw new Error('Parent account does not exist')
    let ancestorCode = parentCode
    while (ancestorCode) {
      if (ancestorCode === code) throw new Error('An account cannot be placed beneath one of its descendants')
      ancestorCode = findAccount.get(ancestorCode)?.parentCode || null
    }
    const balance = nonNegative(input.openingBalance ?? 0, 'Opening balance')
    const exists = findAccount.get(code)
    if (exists) {
      db.prepare('UPDATE accounts SET description = ?, parent_code = ?, opening_balance = ? WHERE code = ?').run(description, parentCode, balance, code)
      recordAudit('ACCOUNT_UPDATE', code)
    } else {
      db.prepare('INSERT INTO accounts(code, description, parent_code, opening_balance) VALUES (?, ?, ?, ?)').run(code, description, parentCode, balance)
      recordAudit('ACCOUNT_SAVE', code)
    }
    return findAccount.get(code)
  }

  function deleteAccount(code) {
    const child = db.prepare('SELECT 1 FROM accounts WHERE parent_code = ? LIMIT 1').get(code)
    if (child) throw new Error('Delete child accounts first')
    const result = db.prepare('DELETE FROM accounts WHERE code = ?').run(code)
    if (!result.changes) throw new Error('Account does not exist')
    recordAudit('ACCOUNT_DELETE', code)
  }

  function listItems() {
    return db.prepare('SELECT code, description, unit, sale_rate AS saleRate, purchase_rate AS purchaseRate, stock_type AS stockType FROM items ORDER BY code').all()
  }

  function saveItem(input) {
    const item = {
      code: required(input.code, 'Item code'), description: required(input.description, 'Description'),
      unit: required(input.unit, 'Unit'), saleRate: nonNegative(input.saleRate, 'Sale rate'),
      purchaseRate: nonNegative(input.purchaseRate, 'Purchase rate'), stockType: required(input.stockType, 'Stock type'),
    }
    if (!db.prepare('SELECT 1 FROM stock_types WHERE code = ?').get(item.stockType)) throw new Error('Selected stock type does not exist')
    const exists = db.prepare('SELECT 1 FROM items WHERE code = ?').get(item.code)
    if (exists) {
      db.prepare('UPDATE items SET description=?, unit=?, sale_rate=?, purchase_rate=?, stock_type=? WHERE code=?')
        .run(item.description, item.unit, item.saleRate, item.purchaseRate, item.stockType, item.code)
      recordAudit('ITEM_UPDATE', item.code)
    } else {
      db.prepare('INSERT INTO items(code, description, unit, sale_rate, purchase_rate, stock_type) VALUES (?, ?, ?, ?, ?, ?)')
        .run(item.code, item.description, item.unit, item.saleRate, item.purchaseRate, item.stockType)
      recordAudit('ITEM_SAVE', item.code)
    }
    return db.prepare('SELECT code, description, unit, sale_rate AS saleRate, purchase_rate AS purchaseRate, stock_type AS stockType FROM items WHERE code=?').get(item.code)
  }

  function deleteItem(code) {
    const result = db.prepare('DELETE FROM items WHERE code = ?').run(code)
    if (!result.changes) throw new Error('Item does not exist')
    recordAudit('ITEM_DELETE', code)
  }

  function listBanks() {
    return db.prepare('SELECT code, name, account_number AS accountNumber, opening_balance AS openingBalance, address, phone FROM banks ORDER BY code').all()
  }

  function saveBank(input) {
    const bank = {
      code: required(input.code, 'Bank code'), name: required(input.name, 'Bank name'),
      accountNumber: String(input.accountNumber || ''), openingBalance: nonNegative(input.openingBalance ?? 0, 'Opening balance'),
      address: String(input.address || ''), phone: String(input.phone || ''),
    }
    const exists = db.prepare('SELECT 1 FROM banks WHERE code = ?').get(bank.code)
    const sql = exists
      ? 'UPDATE banks SET name=?, account_number=?, opening_balance=?, address=?, phone=? WHERE code=?'
      : 'INSERT INTO banks(code, name, account_number, opening_balance, address, phone) VALUES (?, ?, ?, ?, ?, ?)'
    db.prepare(sql).run(...(exists
      ? [bank.name, bank.accountNumber, bank.openingBalance, bank.address, bank.phone, bank.code]
      : [bank.code, bank.name, bank.accountNumber, bank.openingBalance, bank.address, bank.phone]))
    recordAudit(exists ? 'BANK_UPDATE' : 'BANK_SAVE', bank.code)
    return bank
  }

  function deleteBank(code) {
    const result = db.prepare('DELETE FROM banks WHERE code = ?').run(code)
    if (!result.changes) throw new Error('Bank does not exist')
    recordAudit('BANK_DELETE', code)
  }

  function getDashboard() {
    const today = new Date().toISOString().slice(0, 10)
    const counts = {
      accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count,
      items: db.prepare('SELECT COUNT(*) AS count FROM items').get().count,
      banks: db.prepare('SELECT COUNT(*) AS count FROM banks').get().count,
      purchasesToday: db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM challans WHERE type='PURCHASE' AND date=?").get(today).total,
      salesToday: db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM challans WHERE type='SALE' AND date=?").get(today).total,
    }
    const recent = db.prepare('SELECT number, type, date, party, total FROM challans ORDER BY date DESC, number DESC LIMIT 8').all()
    const stock = db.prepare(`SELECT COALESCE(SUM(balance), 0) AS quantity FROM (
      SELECT SUM(quantity) AS balance FROM stock_movements GROUP BY item_code, location HAVING SUM(quantity) > 0
    )`).get().quantity
    return { today, counts, recent, stockQuantity: stock }
  }

  function listChallans(type) {
    const documents = type
      ? db.prepare('SELECT number, type, date, party, location, total FROM challans WHERE type=? ORDER BY date DESC, number DESC').all(type)
      : db.prepare('SELECT number, type, date, party, location, total FROM challans ORDER BY date DESC, number DESC').all()
    const getLines = db.prepare('SELECT line_number AS lineNumber, item_code AS itemCode, quantity, rate, amount FROM challan_lines WHERE challan_number=? ORDER BY line_number')
    return documents.map((document) => ({ ...document, lines: getLines.all(document.number) }))
  }

  function getStock(itemCode, location) {
    return db.prepare('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM stock_movements WHERE item_code=? AND location=?').get(itemCode, location).quantity
  }

  function listLocations() {
    return db.prepare("SELECT DISTINCT location FROM stock_movements WHERE trim(location) <> '' ORDER BY location").all().map((row) => row.location)
  }

  function listStockMovements() {
    return db.prepare(`SELECT id, date, document, type, item_code AS itemCode, location,
      quantity, rate, amount FROM stock_movements ORDER BY date DESC, id DESC`).all()
  }

  function listOpeningBalances() {
    return db.prepare(`SELECT m.id, m.date, m.document, m.item_code AS itemCode,
      i.description AS itemDescription, m.location, m.quantity, m.rate, m.amount
      FROM stock_movements m LEFT JOIN items i ON i.code=m.item_code
      WHERE m.type='OPENING' ORDER BY m.id DESC`).all()
  }

  const addOpeningBalanceTransaction = db.transaction((input) => {
    const itemCode = required(input.itemCode, 'Item code')
    const item = db.prepare('SELECT purchase_rate AS rate FROM items WHERE code=?').get(itemCode)
    if (!item) throw new Error(`Unknown item: ${itemCode}`)
    const location = required(input.location, 'Location')
    const quantity = positive(input.quantity, 'Opening quantity')
    const rate = nonNegative(item.rate, 'Purchase rate')
    const amount = quantity * rate
    db.prepare(`INSERT INTO stock_movements(date, document, type, item_code, location, quantity, rate, amount)
      VALUES (?, 'OPENING', 'OPENING', ?, ?, ?, ?, ?)`).run(new Date().toISOString().slice(0, 10), itemCode, location, quantity, rate, amount)
    recordAudit('OPENING_BALANCE_SAVE', `${itemCode} · ${location} · ${quantity}`)
    return { itemCode, location, quantity, rate, amount }
  })

  const transferStockTransaction = db.transaction((input) => {
    const itemCode = required(input.itemCode, 'Item code')
    if (!db.prepare('SELECT 1 FROM items WHERE code=?').get(itemCode)) throw new Error(`Unknown item: ${itemCode}`)
    const fromLocation = required(input.fromLocation, 'Source location')
    const toLocation = required(input.toLocation, 'Destination location')
    if (fromLocation === toLocation) throw new Error('Source and destination locations must differ')
    const quantity = positive(input.quantity, 'Transfer quantity')
    const available = getStock(itemCode, fromLocation)
    if (available < quantity) throw new Error(`Insufficient stock for transfer: ${itemCode} has ${available} at ${fromLocation}`)
    // This transaction already owns the write lock; allocate within it without
    // attempting to start a nested better-sqlite3 transaction.
    const transferId = allocateOfficeId('transfer')
    const date = new Date().toISOString().slice(0, 10)
    db.prepare(`INSERT INTO stock_transfers(transfer_id, transfer_date, item_code, from_location, to_location, quantity)
      VALUES (?, ?, ?, ?, ?, ?)`).run(transferId, date, itemCode, fromLocation, toLocation, quantity)
    const insert = db.prepare(`INSERT INTO stock_movements(date, document, type, item_code, location, quantity, rate, amount)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)`)
    insert.run(date, transferId, 'TRANSFER OUT', itemCode, fromLocation, -quantity)
    insert.run(date, transferId, 'TRANSFER IN', itemCode, toLocation, quantity)
    recordAudit('STOCK_TRANSFER', `${transferId} · ${itemCode} · ${quantity} · ${fromLocation} → ${toLocation}`)
    return { transferId, date, itemCode, fromLocation, toLocation, quantity }
  })

  function listStockTypes() {
    return db.prepare('SELECT code, description FROM stock_types ORDER BY code').all()
  }

  function saveStockType(input) {
    const code = required(input.code, 'Stock type code').toUpperCase()
    const description = required(input.description, 'Stock type description')
    const exists = db.prepare('SELECT 1 FROM stock_types WHERE code=?').get(code)
    db.prepare(`INSERT INTO stock_types(code, description) VALUES (?, ?)
      ON CONFLICT(code) DO UPDATE SET description=excluded.description`).run(code, description)
    recordAudit(exists ? 'STOCK_TYPE_UPDATE' : 'STOCK_TYPE_SAVE', code)
    return { code, description }
  }

  function deleteStockType(codeInput) {
    const code = required(codeInput, 'Stock type code').toUpperCase()
    if (['REG', 'SER'].includes(code)) throw new Error('Built-in stock types cannot be deleted')
    if (db.prepare('SELECT 1 FROM items WHERE stock_type=? LIMIT 1').get(code)) throw new Error('Stock type is assigned to items and cannot be deleted')
    const result = db.prepare('DELETE FROM stock_types WHERE code=?').run(code)
    if (!result.changes) throw new Error('Stock type does not exist')
    recordAudit('STOCK_TYPE_DELETE', code)
  }

  function listVouchers(types = null) {
    const headers = types?.length
      ? db.prepare(`SELECT number, date, narration, reference, voucher_type AS type FROM vouchers WHERE voucher_type IN (${types.map(() => '?').join(',')}) ORDER BY date DESC, number DESC`).all(...types)
      : db.prepare(`SELECT number, date, narration, reference, voucher_type AS type FROM vouchers ORDER BY date DESC, number DESC`).all()
    const lines = db.prepare(`SELECT line_number AS lineNumber, account_code AS accountCode, debit, credit
      FROM voucher_lines WHERE voucher_number=? ORDER BY line_number`)
    return headers.map((voucher) => ({ ...voucher, lines: lines.all(voucher.number) }))
  }

  function validateVoucher(input) {
    const number = required(input.number, 'Voucher number')
    const date = required(input.date, 'Voucher date')
    const parsedDate = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Voucher date must be a real date in yyyy-MM-dd format')
    const type = String(input.type || 'VOUCHER').trim().toUpperCase()
    if (!['VOUCHER', 'JOURNAL VOUCHER', 'PAYMENT', 'RECEIPT'].includes(type)) throw new Error('Voucher type is not supported')
    if (!Array.isArray(input.lines) || input.lines.length < 2) throw new Error('A balanced voucher needs at least two lines')
    const lines = input.lines.map((line) => {
      const accountCode = required(line.accountCode, 'Account')
      if (!findAccount.get(accountCode)) throw new Error(`Unknown account: ${accountCode}`)
      const debit = nonNegative(line.debit, 'Debit')
      const credit = nonNegative(line.credit, 'Credit')
      if (debit > 0 && credit > 0) throw new Error('A voucher line cannot have both debit and credit')
      if (debit === 0 && credit === 0) throw new Error('Each voucher line needs a debit or credit amount')
      return { accountCode, debit, credit }
    })
    const debitTotal = lines.reduce((sum, line) => sum + line.debit, 0)
    const creditTotal = lines.reduce((sum, line) => sum + line.credit, 0)
    if (Math.abs(debitTotal - creditTotal) > 1e-8) throw new Error('Debit and credit totals must balance')
    return { number, date, type, narration: String(input.narration || '').trim(), reference: String(input.reference || '').trim(), lines }
  }

  const saveVoucherTransaction = db.transaction((input) => {
    const voucher = validateVoucher(input)
    const exists = db.prepare('SELECT 1 FROM vouchers WHERE number=?').get(voucher.number)
    const update = Boolean(input.update)
    if (exists && !update) throw new Error(`Voucher number already exists: ${voucher.number}`)
    if (!exists && update) throw new Error('Voucher does not exist')
    if (exists) {
      const existingType = getVoucherType(voucher.number)
      if (existingType !== voucher.type) throw new Error('An existing voucher cannot be changed to another voucher type')
      db.prepare('UPDATE vouchers SET date=?, narration=?, reference=?, voucher_type=? WHERE number=?')
        .run(voucher.date, voucher.narration, voucher.reference, voucher.type, voucher.number)
      db.prepare('DELETE FROM voucher_lines WHERE voucher_number=?').run(voucher.number)
    } else {
      db.prepare('INSERT INTO vouchers(number,date,narration,reference,voucher_type) VALUES (?,?,?,?,?)')
        .run(voucher.number, voucher.date, voucher.narration, voucher.reference, voucher.type)
    }
    const insert = db.prepare('INSERT INTO voucher_lines(voucher_number,line_number,account_code,debit,credit) VALUES (?,?,?,?,?)')
    voucher.lines.forEach((line, index) => insert.run(voucher.number, index + 1, line.accountCode, line.debit, line.credit))
    recordAudit(exists ? 'VOUCHER_UPDATE' : `${voucher.type.replaceAll(' ', '_')}_POST`, voucher.number)
    return voucher
  })

  function deleteVoucher(numberInput) {
    const number = required(numberInput, 'Voucher number')
    const existing = db.prepare('SELECT voucher_type AS type FROM vouchers WHERE number=?').get(number)
    if (!existing) throw new Error('Voucher does not exist')
    db.transaction(() => {
      db.prepare('DELETE FROM voucher_lines WHERE voucher_number=?').run(number)
      db.prepare('DELETE FROM vouchers WHERE number=?').run(number)
      recordAudit('VOUCHER_DELETE', `${number} · ${existing.type}`)
    })()
  }

  function getVoucherType(number) {
    return db.prepare('SELECT voucher_type AS type FROM vouchers WHERE number=?').get(String(number))?.type ?? null
  }

  const postChallanTransaction = db.transaction((input) => {
    const type = String(input.type || '').toUpperCase()
    if (!['PURCHASE', 'SALE'].includes(type)) throw new Error('Challan type must be Purchase or Sale')
    const number = required(input.number, 'Challan number')
    const date = required(input.date, 'Challan date')
    const party = required(input.party, 'Party')
    const location = required(input.location, 'Location')
    const parsedDate = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Date must be a real date in yyyy-MM-dd format')
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error('Add at least one item line')
    if (db.prepare('SELECT 1 FROM challans WHERE number=?').get(number)) throw new Error(`Challan number already exists: ${number}`)

    const lines = input.lines.map((line) => {
      const itemCode = required(line.itemCode, 'Item code')
      const item = db.prepare('SELECT code, sale_rate, purchase_rate FROM items WHERE code=?').get(itemCode)
      if (!item) throw new Error(`Unknown item: ${itemCode}`)
      const quantity = positive(line.quantity, 'Quantity')
      const rate = nonNegative(type === 'PURCHASE' ? item.purchase_rate : item.sale_rate, 'Item rate')
      return { itemCode, quantity, rate, amount: quantity * rate }
    })
    if (type === 'SALE') {
      const grouped = new Map()
      for (const line of lines) grouped.set(line.itemCode, (grouped.get(line.itemCode) || 0) + line.quantity)
      for (const [itemCode, quantity] of grouped) {
        if (getStock(itemCode, location) < quantity) throw new Error(`Insufficient stock for ${itemCode} at ${location}`)
      }
    }
    const total = lines.reduce((sum, line) => sum + line.amount, 0)
    db.prepare('INSERT INTO challans(number, type, date, party, location, total) VALUES (?, ?, ?, ?, ?, ?)')
      .run(number, type, date, party, location, total)
    const insertLine = db.prepare('INSERT INTO challan_lines(challan_number, line_number, item_code, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)')
    const insertMovement = db.prepare('INSERT INTO stock_movements(date, document, type, item_code, location, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    lines.forEach((line, index) => {
      const signedQuantity = type === 'PURCHASE' ? line.quantity : -line.quantity
      insertLine.run(number, index + 1, line.itemCode, line.quantity, line.rate, line.amount)
      insertMovement.run(date, number, type, line.itemCode, location, signedQuantity, line.rate, signedQuantity * line.rate)
    })
    recordAudit('CHALLAN_POST', number)
    return { number, type, date, party, location, total, lines }
  })

  const updateChallanTransaction = db.transaction((input) => {
    const number = required(input.number, 'Challan number')
    const existing = db.prepare('SELECT number, type FROM challans WHERE number=?').get(number)
    if (!existing) throw new Error('Challan does not exist')
    const type = existing.type
    if (input.type && String(input.type).toUpperCase() !== type) throw new Error('A challan cannot be changed from purchase to sale or vice versa')
    const date = required(input.date, 'Challan date')
    const parsedDate = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Date must be a real date in yyyy-MM-dd format')
    const party = required(input.party, 'Party')
    const location = required(input.location, 'Location')
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error('Add at least one item line')

    // Temporarily remove the old stock effect inside this transaction so the replacement
    // sale is validated against the balance that would exist after the edit.
    const oldMovements = db.prepare('SELECT DISTINCT item_code AS itemCode, location FROM stock_movements WHERE document=?').all(number)
    db.prepare('DELETE FROM stock_movements WHERE document=?').run(number)
    const lines = input.lines.map((line) => {
      const itemCode = required(line.itemCode, 'Item code')
      const item = db.prepare('SELECT sale_rate, purchase_rate FROM items WHERE code=?').get(itemCode)
      if (!item) throw new Error(`Unknown item: ${itemCode}`)
      const quantity = positive(line.quantity, 'Quantity')
      const rate = nonNegative(type === 'PURCHASE' ? item.purchase_rate : item.sale_rate, 'Item rate')
      return { itemCode, quantity, rate, amount: quantity * rate }
    })
    if (type === 'SALE') {
      const grouped = new Map()
      for (const line of lines) grouped.set(line.itemCode, (grouped.get(line.itemCode) || 0) + line.quantity)
      for (const [itemCode, quantity] of grouped) if (getStock(itemCode, location) < quantity) throw new Error(`Insufficient stock for ${itemCode} at ${location}`)
    }
    const total = lines.reduce((sum, line) => sum + line.amount, 0)
    db.prepare('UPDATE challans SET date=?, party=?, location=?, total=? WHERE number=?').run(date, party, location, total, number)
    db.prepare('DELETE FROM challan_lines WHERE challan_number=?').run(number)
    const insertLine = db.prepare('INSERT INTO challan_lines(challan_number, line_number, item_code, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)')
    const insertMovement = db.prepare('INSERT INTO stock_movements(date, document, type, item_code, location, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    lines.forEach((line, index) => {
      const signedQuantity = type === 'PURCHASE' ? line.quantity : -line.quantity
      insertLine.run(number, index + 1, line.itemCode, line.quantity, line.rate, line.amount)
      insertMovement.run(date, number, type, line.itemCode, location, signedQuantity, line.rate, signedQuantity * line.rate)
    })
    const affected = new Map(oldMovements.map((movement) => [`${movement.itemCode}\u0000${movement.location}`, movement]))
    for (const line of lines) affected.set(`${line.itemCode}\u0000${location}`, { itemCode: line.itemCode, location })
    for (const movement of affected.values()) if (getStock(movement.itemCode, movement.location) < -1e-9) {
      throw new Error(`This change would leave ${movement.itemCode} below zero stock at ${movement.location}`)
    }
    recordAudit('CHALLAN_UPDATE', number)
    return { number, type, date, party, location, total, lines }
  })

  const deleteChallanTransaction = db.transaction((numberInput) => {
    const number = required(numberInput, 'Challan number')
    const existing = db.prepare('SELECT number, type FROM challans WHERE number=?').get(number)
    if (!existing) throw new Error('Challan does not exist')
    const movements = db.prepare('SELECT DISTINCT item_code AS itemCode, location FROM stock_movements WHERE document=?').all(number)
    db.prepare('DELETE FROM stock_movements WHERE document=?').run(number)
    if (existing.type === 'PURCHASE') {
      for (const movement of movements) if (getStock(movement.itemCode, movement.location) < -1e-9) {
        throw new Error(`Cannot delete this purchase: later sales would leave ${movement.itemCode} below zero stock at ${movement.location}`)
      }
    }
    db.prepare('DELETE FROM challan_lines WHERE challan_number=?').run(number)
    db.prepare('DELETE FROM challans WHERE number=?').run(number)
    recordAudit('CHALLAN_DELETE', number)
  })

  function saveCheque(input) {
    const cheque = {
      number: required(input.number, 'Cheque number'), bankCode: required(input.bankCode, 'Bank'),
      date: required(input.date, 'Cheque date'), party: required(input.party, 'Party'),
      amount: positive(input.amount, 'Amount'), status: required(input.status, 'Status').toUpperCase(),
      checkNumber: String(input.checkNumber || ''),
    }
    const chequeDate = new Date(`${cheque.date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cheque.date) || Number.isNaN(chequeDate.getTime()) || chequeDate.toISOString().slice(0, 10) !== cheque.date) throw new Error('Cheque date must be a real date in yyyy-MM-dd format')
    if (!['PENDING', 'CLEARED', 'RETURNED', 'CANCELLED'].includes(cheque.status)) throw new Error('Cheque status is not supported')
    if (!db.prepare('SELECT 1 FROM banks WHERE code=?').get(cheque.bankCode)) throw new Error('Selected bank does not exist')
    db.transaction(() => {
      db.prepare(`INSERT INTO cheques(number, bank_code, cheque_date, party, amount, status, manual_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(number) DO UPDATE SET bank_code=excluded.bank_code, cheque_date=excluded.cheque_date,
          party=excluded.party, amount=excluded.amount, status=excluded.status, manual_id=excluded.manual_id`)
        .run(cheque.number, cheque.bankCode, cheque.date, cheque.party, cheque.amount, cheque.status, cheque.checkNumber)
      db.prepare('INSERT INTO cheque_status_history(cheque_number, status, changed_at) VALUES (?, ?, ?)')
        .run(cheque.number, cheque.status, now())
      recordAudit('CHEQUE_SAVE', cheque.number)
    })()
    return cheque
  }

  function listCheques() {
    return db.prepare(`SELECT number, bank_code AS bankCode, cheque_date AS date, party, amount,
      status, manual_id AS checkNumber FROM cheques ORDER BY cheque_date DESC, number DESC`).all()
  }

  const deleteChequeTransaction = db.transaction((numberInput) => {
    const number = required(numberInput, 'Cheque number')
    if (!db.prepare('SELECT 1 FROM cheques WHERE number=?').get(number)) throw new Error('Cheque does not exist')
    db.prepare('DELETE FROM cheque_status_history WHERE cheque_number=?').run(number)
    db.prepare('DELETE FROM cheques WHERE number=?').run(number)
    recordAudit('CHEQUE_DELETE', number)
  })

  return {
    close: () => db.close(), backupTo, exportData, verifyDatabase,
    nextId: (entity) => nextOfficeId(entity),
    getDashboard, getCompanyProfile, hasCompanyProfile, saveCompanyProfile, listAccounts, saveAccount, deleteAccount,
    listItems, saveItem, deleteItem, listBanks, saveBank, deleteBank,
    listChallans, postChallan: (input) => postChallanTransaction(input), updateChallan: (input) => updateChallanTransaction(input), deleteChallan: (number) => deleteChallanTransaction(number),
    getStock, listLocations, listStockMovements, listOpeningBalances,
    addOpeningBalance: (input) => addOpeningBalanceTransaction(input), transferStock: (input) => transferStockTransaction(input),
    listStockTypes, saveStockType, deleteStockType,
    listVouchers, saveVoucher: (input) => saveVoucherTransaction(input), deleteVoucher, getVoucherType,
    listCheques, saveCheque, deleteCheque: (number) => deleteChequeTransaction(number),
    getChallanType: (number) => db.prepare('SELECT type FROM challans WHERE number=?').get(number)?.type ?? null,
    listUsers, getUserSession, saveUser, deleteUser, authenticate, createFirstUser, setCurrentUser, setAuditActor, auditEvents,
    hasUsers: () => Boolean(db.prepare('SELECT 1 FROM users LIMIT 1').get()),
    getStockTypes: listStockTypes,
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256')
  return `pbkdf2$120000$${salt.toString('base64')}$${derived.toString('base64')}`
}

function verifyPassword(password, stored) {
  try {
    if (stored.startsWith('pbkdf2$')) {
      const [, iterations, salt, expected] = stored.split('$')
      const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'base64'), Number(iterations), 32, 'sha256')
      return crypto.timingSafeEqual(hash, Buffer.from(expected, 'base64'))
    }
    const legacy = crypto.createHash('sha256').update(password).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(legacy), Buffer.from(stored))
  } catch { return false }
}

function normalizePermissions(values) {
  const aliases = {
    'Chart of Account': 'Chart of Accounts', Bank: 'Banks', 'Purchase Challan': 'Purchase Challans', 'Sale Challan': 'Sale Challans',
    Reports: 'Reports',
    'Cheque Detail': 'Cheque Detail', 'User Rights': 'User Rights', 'Audit Log': 'Audit Log',
  }
  const permissions = new Set(values.map((permission) => aliases[permission] || permission))
  permissions.add('Overview')
  permissions.add('Manual')
  if (permissions.has('User Rights')) {
    permissions.add('Company Profile')
    permissions.add('Database Tools')
  } else {
    permissions.delete('Company Profile')
  }
  if (permissions.has('User Rights')) {
    permissions.add('Stock Types')
    permissions.add('Item Opening Balances')
    permissions.add('Transfer')
    permissions.add('Voucher')
    permissions.add('Journal Voucher')
    permissions.add('Search Payment')
    permissions.add('Payment / Receipt')
  }
  return [...permissions]
}

function required(value, label) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${label} is required`)
  return text
}

function positive(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero`)
  return number
}

function nonNegative(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} cannot be negative`)
  return number
}

module.exports = { openOfficeDatabase }
