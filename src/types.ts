export type Account = { code: string; description: string; parentCode: string | null; openingBalance: number }
export type Item = { code: string; description: string; unit: string; saleRate: number; purchaseRate: number; stockType: string }
export type Bank = { code: string; name: string; accountNumber: string; openingBalance: number; address: string; phone: string }
export type StockType = { code: string; description: string }
export type StockMovement = { id: number; date: string; document: string; type: string; itemCode: string; location: string; quantity: number; rate: number; amount: number }
export type OpeningBalance = { id: number; date: string; document: string; itemCode: string; itemDescription: string | null; location: string; quantity: number; rate: number; amount: number }
export type ChallanLine = { lineNumber?: number; itemCode: string; quantity: number; rate: number; amount: number }
export type Challan = { number: string; type: string; date: string; party: string; location: string; total: number; lines: ChallanLine[] }
export type Cheque = { number: string; bankCode: string; date: string; party: string; amount: number; status: string; checkNumber: string }
export type VoucherLine = { lineNumber?: number; accountCode: string; debit: number; credit: number }
export type Voucher = { number: string; date: string; narration: string; reference: string; type: 'VOUCHER' | 'JOURNAL VOUCHER' | 'PAYMENT' | 'RECEIPT'; lines: VoucherLine[] }
export type Dashboard = {
  today: string
  counts: { accounts: number; items: number; banks: number; purchasesToday: number; salesToday: number }
  recent: Array<{ number: string; type: string; date: string; party: string; total: number }>
  stockQuantity: number
}
export type OfficeUser = { username: string; permissions: string[] }
export type AuditEvent = { eventTime: string; username: string; action: string; details: string }
export type OfficeSession = { username: string; permissions: string[] }
export type DatabaseVerification = { ok: boolean; integrity: string[]; foreignKeyViolations: Array<Record<string, unknown>>; tableCounts: Record<string, number>; checkedAt: string }
export type CompanyProfile = { name: string; address: string; phone: string; fiscalYear: string; logoPath: string }

export type OfficeBridge = {
  auth: {
    status: () => Promise<{ hasUsers: boolean; hasCompanyProfile: boolean; session: OfficeSession | null }>
    setup: (value: { username: string; password: string }) => Promise<OfficeSession>
    login: (value: { username: string; password: string }) => Promise<OfficeSession>
    logout: () => Promise<void>
  }
  app: { quit: () => Promise<void>; menuAction: (action: 'reload' | 'forceReload' | 'devTools' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'minimize' | 'close' | 'fullscreen' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => Promise<void> }
  users: { list: () => Promise<OfficeUser[]>; save: (value: { username: string; password: string; permissions: string[] }) => Promise<OfficeUser>; remove: (username: string) => Promise<void> }
  audit: { list: () => Promise<AuditEvent[]> }
  database: {
    backup: () => Promise<{ fileName: string; bytes: number; path: string }>
    exportData: () => Promise<{ canceled: boolean; path?: string; bytes?: number }>
    verify: () => Promise<DatabaseVerification>
    openBackups: () => Promise<void>
  }
  ids: { next: (entity: 'account' | 'item' | 'bank' | 'purchaseChallan' | 'saleChallan' | 'cheque' | 'transfer' | 'voucher') => Promise<string> }
  dashboard: () => Promise<Dashboard>
  company: { get: () => Promise<CompanyProfile>; save: (value: CompanyProfile) => Promise<CompanyProfile>; logo: () => Promise<string | null>; pathForFile: (file: File) => string }
  accounts: { list: () => Promise<Account[]>; save: (value: Omit<Account, 'openingBalance'> & { openingBalance: number }) => Promise<Account>; remove: (code: string) => Promise<void> }
  items: { list: () => Promise<Item[]>; save: (value: Item) => Promise<Item>; remove: (code: string) => Promise<void> }
  banks: { list: () => Promise<Bank[]>; save: (value: Bank) => Promise<Bank>; remove: (code: string) => Promise<void> }
  challans: { list: (type?: string) => Promise<Challan[]>; post: (value: Omit<Challan, 'total' | 'lines'> & { lines: Array<Pick<ChallanLine, 'itemCode' | 'quantity'>> }) => Promise<Challan>; update: (value: Omit<Challan, 'total' | 'lines'> & { lines: Array<Pick<ChallanLine, 'itemCode' | 'quantity'>> }) => Promise<Challan>; remove: (number: string) => Promise<void> }
  cheques: { list: () => Promise<Cheque[]>; save: (value: Cheque) => Promise<Cheque>; remove: (number: string) => Promise<void> }
  vouchers: { list: () => Promise<Voucher[]>; save: (value: Voucher & { update?: boolean }) => Promise<Voucher>; remove: (number: string) => Promise<void> }
  stock: {
    locations: () => Promise<string[]>
    quantity: (itemCode: string, location: string) => Promise<number>
    types: () => Promise<StockType[]>
    saveType: (value: StockType) => Promise<StockType>
    removeType: (code: string) => Promise<void>
    movements: () => Promise<StockMovement[]>
    openings: () => Promise<OpeningBalance[]>
    addOpening: (value: { itemCode: string; location: string; quantity: number }) => Promise<{ itemCode: string; location: string; quantity: number; rate: number; amount: number }>
    transfer: (value: { itemCode: string; fromLocation: string; toLocation: string; quantity: number }) => Promise<{ transferId: string; date: string; itemCode: string; fromLocation: string; toLocation: string; quantity: number }>
  }
}

declare global { interface Window { office: OfficeBridge } }
