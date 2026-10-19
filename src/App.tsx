import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpFromLine, BookOpen, Building2, ChevronDown, ChevronRight, CornerDownRight, Database, FileClock, Home, Keyboard, Landmark, LayoutDashboard, LogOut, Moon, Package, Plus, Printer, RefreshCw, Search, Settings2, Shield, Sun, Trash2, WalletCards, X } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field as UiField, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import type { Account, AuditEvent, Bank, Challan, Cheque, CompanyProfile, Dashboard, Item, OfficeSession, OfficeUser, OpeningBalance, StockMovement, StockType, Voucher } from '@/types'
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from '@/components/ui/menubar'
import { PaymentSearchPage, ReportsPage as FullReportsPage, REPORT_NAMES, VoucherEntryPage } from '@/components/OfficePages'
import { DatabaseToolsPage } from '@/components/DatabaseToolsPage'
import { PrintDocument, requestPrint } from '@/components/PrintDocument'
import { DatePicker } from '@/components/DatePicker'
import { readTablePageSize, saveTablePageSize, TABLE_PAGE_SIZE_OPTIONS } from '@/lib/preferences'
import { APP_KEYBINDINGS, matchAppKeybinding } from '@/lib/app-keybindings'
import { karachiGreeting } from '@/lib/karachi-time'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'

type Page = 'home' | 'company' | 'accounts' | 'items' | 'banks' | 'stockTypes' | 'opening' | 'transfer' | 'purchase' | 'sale' | 'cheques' | 'voucher' | 'journal' | 'payment' | 'paymentSearch' | 'reports' | 'users' | 'audit' | 'database' | 'settings' | 'manual' | 'keybindings'
const pageNames: Record<Page, string> = { home: 'Overview', company: 'Company Profile', accounts: 'Chart of Accounts', items: 'Items', banks: 'Banks', stockTypes: 'Stock Types', opening: 'Item Opening Balances', transfer: 'Transfer', purchase: 'Purchase Challans', sale: 'Sale Challans', cheques: 'Cheque Detail', voucher: 'Voucher', journal: 'Journal Voucher', payment: 'Payment / Receipt', paymentSearch: 'Search Payment', reports: 'Reports', users: 'User Rights', audit: 'Audit Log', database: 'Database Tools', settings: 'Settings', manual: 'Manual', keybindings: 'Keybindings' }
const permissionPages: Page[] = ['home', 'accounts', 'items', 'banks', 'stockTypes', 'opening', 'transfer', 'cheques', 'purchase', 'sale', 'voucher', 'journal', 'paymentSearch', 'payment', 'reports', 'users', 'audit', 'database', 'manual']
const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const today = () => new Date().toISOString().slice(0, 10)
type SearchRecord = { page: Page; title: string; detail: string; kind: string; fields: Record<string, string> }

function searchParts(query: string) {
  const tokens = query.match(/"[^"]+"|\S+/g)?.map((token) => token.replace(/^"|"$/g, '')) ?? []
  const kinds: string[] = []
  const fields: string[] = []
  const terms: string[] = []
  for (const token of tokens) {
    const qualifier = token.match(/^(type|in):(.+)$/i)
    if (!qualifier) { terms.push(token.toLowerCase()); continue }
    if (qualifier[1].toLowerCase() === 'type') kinds.push(qualifier[2].toLowerCase())
    else fields.push(qualifier[2].toLowerCase())
  }
  return { kinds, fields, terms, plain: terms.join(' ') }
}

function matchesRecord(record: SearchRecord, query: string) {
  const parsed = searchParts(query)
  const kindAliases: Record<string, string[]> = {
    account: ['account'], item: ['item'], bank: ['bank'], challan: ['purchase-challan', 'sale-challan'],
    purchase: ['purchase-challan'], sale: ['sale-challan'], cheque: ['cheque'], voucher: ['voucher'],
    journal: ['journal-voucher'], payment: ['payment', 'receipt'], receipt: ['receipt'], opening: ['opening-balance'], transfer: ['transfer'],
  }
  if (parsed.kinds.length && !parsed.kinds.some((kind) => (kindAliases[kind] ?? [kind]).includes(record.kind))) return false
  const fieldEntries = Object.entries(record.fields)
  const scopedEntries = parsed.fields.length
    ? fieldEntries.filter(([field]) => parsed.fields.includes(field.toLowerCase()))
    : fieldEntries
  if (parsed.fields.length && !scopedEntries.length) return false
  const haystack = scopedEntries.map(([, value]) => value.toLowerCase()).join(' ')
  return parsed.terms.every((term) => haystack.includes(term))
}

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [session, setSession] = useState<OfficeSession | null>(null)
  const [hasUsers, setHasUsers] = useState(true)
  const [companySetupNeeded, setCompanySetupNeeded] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [history, setHistory] = useState<Page[]>(['home'])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('purchase-sale-theme') === 'dark')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [confirmAction, setConfirmAction] = useState<'logout' | 'quit' | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [users, setUsers] = useState<OfficeUser[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null)
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [challans, setChallans] = useState<Challan[]>([])
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [stockTypes, setStockTypes] = useState<StockType[]>([])
  const [openingBalances, setOpeningBalances] = useState<OpeningBalance[]>([])
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [selectedReport, setSelectedReport] = useState('Purchase Register')
  const [locations, setLocations] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.office.auth.status().then((status) => {
      setHasUsers(status.hasUsers)
      setCompanySetupNeeded(!status.hasCompanyProfile)
      setSession(status.session)
      if (status.session) setPage(status.hasCompanyProfile ? 'home' : 'company')
    }).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not check sign-in status')).finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light'
    window.localStorage.setItem('purchase-sale-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const can = (name: Page) => Boolean(session?.permissions.includes(pageNames[name]))
      const canPrint = ['company', 'purchase', 'sale', 'voucher', 'journal', 'payment', 'reports'].some((name) => can(name as Page))
      const [summary, profile, logo, accountRows, itemRows, bankRows, challanRows, chequeRows, types, places, openings, movements, voucherRows] = await Promise.all([
        can('home') ? window.office.dashboard() : null,
        canPrint ? window.office.company.get() : null,
        canPrint ? window.office.company.logo() : null,
        can('accounts') || can('purchase') || can('sale') || can('reports') || can('voucher') || can('journal') || can('payment') || can('paymentSearch') ? window.office.accounts.list() : [],
        can('items') || can('purchase') || can('sale') || can('reports') ? window.office.items.list() : [],
        can('banks') || can('cheques') ? window.office.banks.list() : [],
        can('reports') || can('purchase') && can('sale') ? window.office.challans.list() : Promise.all([
          can('purchase') ? window.office.challans.list('PURCHASE') : Promise.resolve([]),
          can('sale') ? window.office.challans.list('SALE') : Promise.resolve([]),
        ]).then((groups) => groups.flat()),
        can('cheques') || can('reports') ? window.office.cheques.list() : [],
        can('items') || can('purchase') || can('sale') || can('stockTypes') ? window.office.stock.types() : [],
        can('purchase') || can('sale') || can('opening') || can('transfer') || can('reports') ? window.office.stock.locations() : [],
        can('opening') ? window.office.stock.openings() : [],
        can('reports') || can('transfer') || can('opening') ? window.office.stock.movements() : [],
        can('reports') || can('voucher') || can('journal') || can('payment') || can('paymentSearch') ? window.office.vouchers.list() : [],
      ])
      setDashboard(summary); if (profile) setCompanyProfile(profile); setCompanyLogo(logo); setAccounts(accountRows); setItems(itemRows); setBanks(bankRows); setChallans(challanRows); setCheques(chequeRows); setStockTypes(types); setLocations(places); setOpeningBalances(openings); setStockMovements(movements); setVouchers(voucherRows)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not load office data') }
    finally { setBusy(false) }
  }, [session])

  useEffect(() => { if (session) void refresh() }, [refresh, session])

  useEffect(() => {
    if (!session) return
    if (page === 'users') void window.office.users.list().then(setUsers).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load user rights'))
    if (page === 'audit') void window.office.audit.list().then(setAuditEvents).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load audit log'))
  }, [page, session])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchAppKeybinding(event)
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'search': setPaletteQuery(''); setPaletteOpen(true); break
        case 'back': goBack(); break
        case 'forward': goForward(); break
        case 'home': navigate('home'); break
        case 'keybindings': navigate('keybindings'); break
        case 'quit': setConfirmAction('quit'); break
        default: void window.office.app.menuAction(action).catch((error) => toast.error(error instanceof Error ? error.message : 'Keyboard action failed'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const navigate = (nextPage: Page) => {
    if (companySetupNeeded && nextPage !== 'company') { toast.info('Finish company profile setup before using the office workspace'); return }
    if (nextPage !== 'settings' && nextPage !== 'keybindings' && !session?.permissions.includes(pageNames[nextPage])) { toast.error('Your account does not have access to that page'); return }
    setPage(nextPage); setQuery(''); setPaletteOpen(false)
    setHistory((current) => [...current.slice(0, historyIndex + 1), nextPage])
    setHistoryIndex((current) => current + 1)
  }
  const goBack = () => { if (historyIndex > 0) { const next = historyIndex - 1; setHistoryIndex(next); setPage(history[next]); setQuery('') } }
  const goForward = () => { if (historyIndex < history.length - 1) { const next = historyIndex + 1; setHistoryIndex(next); setPage(history[next]); setQuery('') } }

  const nav = [
    { id: 'home' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'company' as const, label: 'Company Profile', icon: Building2 },
    { id: 'accounts' as const, label: 'Chart of Accounts', icon: Building2 },
    { id: 'items' as const, label: 'Items', icon: Package },
    { id: 'banks' as const, label: 'Banks', icon: Landmark },
    { id: 'stockTypes' as const, label: 'Stock Types', icon: Package },
    { id: 'opening' as const, label: 'Opening Balances', icon: ArrowDownToLine },
    { id: 'transfer' as const, label: 'Transfer', icon: ArrowLeftRight },
    { id: 'cheques' as const, label: 'Cheque Detail', icon: WalletCards },
    { id: 'voucher' as const, label: 'Voucher', icon: FileClock },
    { id: 'journal' as const, label: 'Journal Voucher', icon: FileClock },
    { id: 'paymentSearch' as const, label: 'Search Payment', icon: Search },
    { id: 'payment' as const, label: 'Payment / Receipt', icon: WalletCards },
    { id: 'purchase' as const, label: 'Purchase Challans', icon: ArrowDownToLine },
    { id: 'sale' as const, label: 'Sale Challans', icon: ArrowUpFromLine },
    { id: 'reports' as const, label: 'Reports', icon: FileClock },
    { id: 'users' as const, label: 'User Rights', icon: Shield },
    { id: 'audit' as const, label: 'Audit Log', icon: FileClock },
    { id: 'database' as const, label: 'Database Tools', icon: Database },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 },
    { id: 'manual' as const, label: 'Manual', icon: BookOpen },
    { id: 'keybindings' as const, label: 'Keybindings', icon: Keyboard },
  ]

  if (authLoading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Checking sign-in…</div>
  if (!session) return <SignInPage setup={!hasUsers} onSuccess={(value) => { setSession(value); setHasUsers(true); setPage(companySetupNeeded ? 'company' : 'home') }} />

  const permittedNav = nav.filter(({ id }) => id === 'settings' || id === 'keybindings' || session.permissions.includes(pageNames[id]))
  const searchableRecords: SearchRecord[] = [
    ...accounts.map((row) => ({ page: 'accounts' as const, title: `${row.code} — ${row.description}`, detail: 'Chart of Accounts', kind: 'account', fields: { code: row.code, description: row.description, parent: row.parentCode ?? '' } })),
    ...items.map((row) => ({ page: 'items' as const, title: `${row.code} — ${row.description}`, detail: `Item · ${row.stockType}`, kind: 'item', fields: { code: row.code, description: row.description, unit: row.unit, stockType: row.stockType } })),
    ...banks.map((row) => ({ page: 'banks' as const, title: `${row.code} — ${row.name}`, detail: 'Bank', kind: 'bank', fields: { code: row.code, name: row.name, accountNumber: row.accountNumber ?? '' } })),
    ...challans.map((row) => ({ page: row.type === 'PURCHASE' ? 'purchase' as const : 'sale' as const, title: `${row.number} — ${row.party}`, detail: `${row.type} challan · ${row.date}`, kind: `${row.type.toLowerCase()}-challan`, fields: { number: row.number, date: row.date, party: row.party, location: row.location, total: String(row.total), type: row.type } })),
    ...cheques.map((row) => ({ page: 'cheques' as const, title: `${row.number} — ${row.party}`, detail: `Cheque · ${row.status} · ${row.date}`, kind: 'cheque', fields: { number: row.number, checkNumber: row.checkNumber ?? '', party: row.party, date: row.date, status: row.status, amount: String(row.amount) } })),
    ...vouchers.map((row) => {
      const page: Page = row.type === 'JOURNAL VOUCHER' ? 'journal' : row.type === 'VOUCHER' ? 'voucher' : session.permissions.includes(pageNames.paymentSearch) ? 'paymentSearch' : 'payment'
      return { page, title: `${row.number} — ${row.narration || row.type}`, detail: `${row.type} · ${row.date}`, kind: row.type === 'JOURNAL VOUCHER' ? 'journal-voucher' : row.type.toLowerCase(), fields: { number: row.number, type: row.type, date: row.date, reference: row.reference, narration: row.narration, account: row.lines.map((line) => line.accountCode).join(' '), amount: row.lines.map((line) => line.debit + line.credit).join(' ') } }
    }),
    ...openingBalances.map((row) => ({ page: 'opening' as const, title: `${row.itemCode} — ${row.itemDescription ?? 'Opening balance'}`, detail: `Opening balance · ${row.location} · ${row.date}`, kind: 'opening-balance', fields: { item: row.itemCode, description: row.itemDescription ?? '', location: row.location, date: row.date, quantity: String(row.quantity) } })),
    ...stockMovements.filter((row) => row.type.startsWith('TRANSFER')).map((row) => ({ page: 'transfer' as const, title: `${row.document} — ${row.itemCode}`, detail: `Stock transfer · ${row.location} · ${row.date}`, kind: 'transfer', fields: { number: row.document, item: row.itemCode, location: row.location, date: row.date, type: row.type, quantity: String(row.quantity) } })),
  ].filter((row) => session.permissions.includes(pageNames[row.page]))
  const matchedRecords = paletteQuery.trim().length >= 2 ? searchableRecords.filter((row) => matchesRecord(row, paletteQuery)).slice(0, 30) : []
  const searchText = searchParts(paletteQuery).plain

  const filteredItems = items.filter((row) => `${row.code} ${row.description} ${row.stockType}`.toLowerCase().includes(query.toLowerCase()))
  const filteredBanks = banks.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(query.toLowerCase()))

  const runMenuAction = (action: Parameters<typeof window.office.app.menuAction>[0]) => { void window.office.app.menuAction(action).catch((error) => toast.error(error instanceof Error ? error.message : 'Menu action failed')) }
  const isAllowed = (target: Page) => permittedNav.some(({ id }) => id === target)

  return <ContextMenu>
    <ContextMenuTrigger className="block min-h-svh select-text">
    <div className="flex h-svh min-h-0 flex-col gap-1.5 overflow-hidden bg-muted/50 p-2 sm:p-2.5">
    <header className="flex h-11 shrink-0 items-center gap-2 rounded-lg border bg-background px-3 shadow-sm">
      <div className="flex shrink-0 items-center gap-2"><div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><WalletCards /></div><p className="max-w-44 truncate text-sm font-semibold leading-tight">{companyProfile?.name || 'Purchase Sale'}</p></div>
      <Menubar className="min-w-0 flex-1 overflow-x-auto border-0 bg-transparent p-0">
        <MenubarMenu><MenubarTrigger>File</MenubarTrigger><MenubarContent><MenubarItem disabled={!isAllowed('purchase')} onClick={() => navigate('purchase')}>Purchase Challans…</MenubarItem><MenubarItem disabled={!isAllowed('sale')} onClick={() => navigate('sale')}>Sale Challans…</MenubarItem><MenubarSeparator /><MenubarItem disabled={!isAllowed('database')} onClick={() => navigate('database')}>Database tools…</MenubarItem><MenubarSeparator /><MenubarItem onClick={() => setConfirmAction('quit')}>Quit<MenubarShortcut>Alt+F4</MenubarShortcut></MenubarItem></MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>Edit</MenubarTrigger><MenubarContent><MenubarItem onClick={() => runMenuAction('undo')}>Undo<MenubarShortcut>Ctrl+Z</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('redo')}>Redo<MenubarShortcut>Ctrl+Y</MenubarShortcut></MenubarItem><MenubarSeparator /><MenubarItem onClick={() => runMenuAction('cut')}>Cut<MenubarShortcut>Ctrl+X</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('copy')}>Copy<MenubarShortcut>Ctrl+C</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('paste')}>Paste<MenubarShortcut>Ctrl+V</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('selectAll')}>Select all<MenubarShortcut>Ctrl+A</MenubarShortcut></MenubarItem></MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>View</MenubarTrigger><MenubarContent><MenubarItem onClick={() => setDarkMode((current) => !current)}>{darkMode ? 'Switch to light theme' : 'Switch to dark theme'}</MenubarItem><MenubarSeparator /><MenubarItem onClick={() => runMenuAction('reload')}>Reload<MenubarShortcut>Ctrl+R</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('forceReload')}>Force reload</MenubarItem><MenubarSeparator /><MenubarItem onClick={() => runMenuAction('zoomIn')}>Zoom in<MenubarShortcut>Ctrl++</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('zoomOut')}>Zoom out<MenubarShortcut>Ctrl+-</MenubarShortcut></MenubarItem><MenubarItem onClick={() => runMenuAction('resetZoom')}>Reset zoom</MenubarItem><MenubarItem onClick={() => runMenuAction('fullscreen')}>Toggle full screen</MenubarItem></MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>Masters</MenubarTrigger><MenubarContent>{(['accounts', 'items', 'banks', 'stockTypes'] as Page[]).map((target) => <MenubarItem key={target} disabled={!isAllowed(target)} onClick={() => navigate(target)}>{pageNames[target]}</MenubarItem>)}</MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>Transactions</MenubarTrigger><MenubarContent>{(['purchase', 'sale', 'voucher', 'journal', 'payment', 'paymentSearch', 'cheques', 'opening', 'transfer'] as Page[]).map((target) => <MenubarItem key={target} disabled={!isAllowed(target)} onClick={() => navigate(target)}>{pageNames[target]}</MenubarItem>)}</MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>Reports</MenubarTrigger><MenubarContent className="max-h-[70vh] overflow-y-auto">{REPORT_NAMES.map((name) => <MenubarItem key={name} disabled={!isAllowed('reports')} onClick={() => { setSelectedReport(name); navigate('reports') }}>{name}</MenubarItem>)}</MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>Administration</MenubarTrigger><MenubarContent>{(['company', 'users', 'audit', 'database', 'settings'] as Page[]).map((target) => <MenubarItem key={target} disabled={!isAllowed(target)} onClick={() => navigate(target)}>{pageNames[target]}</MenubarItem>)}</MenubarContent></MenubarMenu>
        <MenubarMenu><MenubarTrigger>Help</MenubarTrigger><MenubarContent><MenubarItem disabled={!isAllowed('manual')} onClick={() => navigate('manual')}>User manual</MenubarItem><MenubarItem onClick={() => navigate('keybindings')}>Keybindings <MenubarShortcut>F1</MenubarShortcut></MenubarItem><MenubarSeparator /><MenubarItem onClick={() => setAboutOpen(true)}><Building2 data-icon="inline-start" />About Purchase Sale Office</MenubarItem></MenubarContent></MenubarMenu>
      </Menubar>
      <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">{session.username}</Badge>
    </header>
    <nav aria-label="Application toolbar" className="flex h-9 shrink-0 flex-wrap items-center gap-1 px-0.5">
      <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back (Alt+Left)" disabled={historyIndex === 0} onClick={goBack}><ArrowLeft /></Button><Button variant="ghost" size="icon-sm" aria-label="Forward" title="Forward (Alt+Right)" disabled={historyIndex >= history.length - 1} onClick={goForward}><ArrowRight /></Button><Separator orientation="vertical" className="mx-1 h-5" />
      <h1 className="mr-auto min-w-0 truncate px-2 text-base font-semibold">{pageNames[page]}</h1>
      <Button variant="outline" size="icon-sm" aria-label="Home" title="Home" onClick={() => navigate('home')}><Home /></Button><Button variant="outline" size="icon-sm" aria-label="Manual" title="Manual" onClick={() => navigate('manual')}><BookOpen /></Button><Button variant="outline" size="icon-sm" aria-label="Global search and commands" title="Search / commands (Ctrl+K)" onClick={() => { setPaletteQuery(''); setPaletteOpen(true) }}><Search /></Button><Button variant="outline" size="icon-sm" aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'} title={darkMode ? 'Light theme' : 'Dark theme'} onClick={() => setDarkMode((current) => !current)}>{darkMode ? <Sun /> : <Moon />}</Button><Button variant="outline" size="icon-sm" aria-label="Refresh" title="Refresh data" onClick={() => void refresh()} disabled={busy}><RefreshCw className={busy ? 'animate-spin' : ''} /></Button><Button variant="ghost" size="icon-sm" aria-label="Log out" title="Log out" onClick={() => setConfirmAction('logout')}><LogOut /></Button><Button variant="ghost" size="icon-sm" aria-label="Quit" title="Quit application" onClick={() => setConfirmAction('quit')}><X /></Button>
    </nav>
    <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-y-auto rounded-xl border bg-background p-4 shadow-sm md:p-5">
        {page === 'home' && <DashboardPage dashboard={dashboard} onNavigate={navigate} allowedPages={permittedNav.map(({ id }) => id)} username={session.username} />}
        {page === 'database' && <DatabaseToolsPage />}
        {page === 'company' && <CompanyProfilePage profile={companyProfile} onboarding={companySetupNeeded} onSave={async (value) => { const saved = await window.office.company.save(value); setCompanyProfile(saved); setCompanySetupNeeded(false); await refresh(); toast.success('Company profile saved'); if (companySetupNeeded) { setPage('home'); setHistory(['home']); setHistoryIndex(0) } }} />}
        {page === 'accounts' && <MasterPage title="Chart of Accounts" description="Organize parties and ledger accounts in a parent-child chart." search={query} onSearch={setQuery}>
          <AccountsTable accounts={accounts} query={query} onSave={async (value) => { await window.office.accounts.save(value); await refresh() }} onDelete={async (code) => { await window.office.accounts.remove(code); await refresh() }} />
        </MasterPage>}
        {page === 'items' && <MasterPage title="Items" description="Maintain item codes, units, rates, and stock classifications." search={query} onSearch={setQuery}>
          <ItemsTable rows={filteredItems} stockTypes={stockTypes} onSave={async (value) => { await window.office.items.save(value); await refresh() }} onDelete={async (code) => { await window.office.items.remove(code); await refresh() }} />
        </MasterPage>}
        {page === 'banks' && <MasterPage title="Banks" description="Bank master records used by cheque and payment workflows." search={query} onSearch={setQuery}>
          <BanksTable rows={filteredBanks} onSave={async (value) => { await window.office.banks.save(value); await refresh() }} onDelete={async (code) => { await window.office.banks.remove(code); await refresh() }} />
        </MasterPage>}
        {page === 'stockTypes' && <StockTypesPage rows={stockTypes} onSave={async (value) => { const saved = await window.office.stock.saveType(value); setStockTypes(await window.office.stock.types()); toast.success(`Stock type ${saved.code} saved`) }} onDelete={async (code) => { await window.office.stock.removeType(code); setStockTypes(await window.office.stock.types()) }} />}
        {page === 'opening' && <OpeningBalancesPage rows={openingBalances} items={items} locations={locations} onAdd={async (value) => { await window.office.stock.addOpening(value); await refresh(); toast.success('Opening balance added') }} />}
        {page === 'transfer' && <TransferPage items={items} locations={locations} movements={stockMovements} onTransfer={async (value) => { const result = await window.office.stock.transfer(value); await refresh(); toast.success(`Transfer ${result.transferId} saved`) }} />}
        {(page === 'purchase' || page === 'sale') && <ChallanPage type={page === 'purchase' ? 'PURCHASE' : 'SALE'} rows={challans.filter((row) => row.type === (page === 'purchase' ? 'PURCHASE' : 'SALE'))} items={items} accounts={accounts} locations={locations} company={companyProfile} logo={companyLogo} onPost={async (value) => { await window.office.challans.post(value); await refresh() }} onUpdate={async (value) => { await window.office.challans.update(value); await refresh() }} onDelete={async (number) => { await window.office.challans.remove(number); await refresh() }} />}
        {page === 'cheques' && <ChequePage rows={cheques} banks={banks} accounts={accounts} onSave={async (value) => { await window.office.cheques.save(value); await refresh() }} onDelete={async (number) => { await window.office.cheques.remove(number); await refresh() }} />}
        {(page === 'voucher' || page === 'journal' || page === 'payment') && <VoucherEntryPage type={page === 'voucher' ? 'VOUCHER' : page === 'journal' ? 'JOURNAL VOUCHER' : 'PAYMENT'} accounts={accounts} vouchers={vouchers.filter((row) => page === 'voucher' ? row.type === 'VOUCHER' : page === 'journal' ? row.type === 'JOURNAL VOUCHER' : row.type === 'PAYMENT' || row.type === 'RECEIPT')} company={companyProfile} logo={companyLogo} onSave={async (value) => { await window.office.vouchers.save(value); await refresh(); toast.success(`${value.type} saved`) }} onDelete={async (number) => { await window.office.vouchers.remove(number); await refresh(); toast.success('Voucher deleted') }} />}
        {page === 'paymentSearch' && <PaymentSearchPage vouchers={vouchers.filter((row) => row.type === 'PAYMENT' || row.type === 'RECEIPT')} accounts={accounts} />}
        {page === 'reports' && <FullReportsPage reportName={selectedReport} onReportChange={setSelectedReport} challans={challans} items={items} accounts={accounts} movements={stockMovements} cheques={cheques} vouchers={vouchers} company={companyProfile} logo={companyLogo} />}
        {page === 'users' && <UserRightsPage currentUsername={session.username} users={users} onRefresh={() => void window.office.users.list().then(setUsers)} onSave={async (value) => { const updated = await window.office.users.save(value); setUsers(await window.office.users.list()); if (updated.username === session.username) setSession((current) => current ? { ...current, permissions: updated.permissions } : current); toast.success('User rights saved') }} onDelete={async (username) => { await window.office.users.remove(username); setUsers(await window.office.users.list()); toast.success('User deleted') }} />}
        {page === 'audit' && <AuditLogPage events={auditEvents} onRefresh={() => void window.office.audit.list().then(setAuditEvents)} />}
        {page === 'settings' && <SettingsPage darkMode={darkMode} onThemeChange={setDarkMode} />}
        {page === 'manual' && <ReferenceManualPage />}
        {page === 'keybindings' && <KeybindingsPage />}
    </main>
    <footer className="flex shrink-0 items-center justify-between px-2 text-xs text-muted-foreground"><span>Ready · Local SQLite</span><span>{dashboard?.today ?? today()}</span></footer>
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Navigation and global search" description="Search permitted office records. Qualifiers: type:challan, type:cheque, in:party, in:date.">
      <Command value={undefined} shouldFilter={false}>
        <CommandInput placeholder="Search records (e.g. type:challan in:party Acme)…" value={paletteQuery} onValueChange={setPaletteQuery} />
        <CommandList>
          {permittedNav.filter(({ label }) => !searchText || label.toLowerCase().includes(searchText.toLowerCase())).length > 0 && <CommandGroup heading="Pages">{permittedNav.filter(({ label }) => !searchText || label.toLowerCase().includes(searchText.toLowerCase())).map(({ id, label, icon: Icon }) => <CommandItem key={id} value={`page ${label}`} onSelect={() => navigate(id)}><Icon />{label}<CommandShortcut>Open</CommandShortcut></CommandItem>)}</CommandGroup>}
          {matchedRecords.length > 0 && <><CommandSeparator /><CommandGroup heading={`Records · ${matchedRecords.length} shown`}>{matchedRecords.map((record) => <CommandItem key={`${record.page}-${record.title}`} value={`${record.title} ${record.detail}`} onSelect={() => navigate(record.page)}><Search />{record.title}<CommandShortcut>{record.detail}</CommandShortcut></CommandItem>)}</CommandGroup></>}
          {isAllowed('reports') && REPORT_NAMES.filter((name) => !searchText || name.toLowerCase().includes(searchText.toLowerCase())).length > 0 && <><CommandSeparator /><CommandGroup heading="Reports">{REPORT_NAMES.filter((name) => !searchText || name.toLowerCase().includes(searchText.toLowerCase())).map((name) => <CommandItem key={`report-${name}`} value={`report ${name}`} onSelect={() => { setSelectedReport(name); navigate('reports') }}><FileClock />{name}<CommandShortcut>Report</CommandShortcut></CommandItem>)}</CommandGroup></>}
          <CommandSeparator /><CommandGroup heading="Common actions">
            <CommandItem value="open purchase challans" disabled={!isAllowed('purchase')} onSelect={() => navigate('purchase')}><ArrowDownToLine />Open purchase challans</CommandItem>
            <CommandItem value="open sale challans" disabled={!isAllowed('sale')} onSelect={() => navigate('sale')}><ArrowUpFromLine />Open sale challans</CommandItem>
            <CommandItem value="database backup export verify tools" disabled={!isAllowed('database')} onSelect={() => navigate('database')}><Database />Database tools</CommandItem>
            <CommandItem value="action refresh" onSelect={() => { setPaletteOpen(false); void refresh() }}><RefreshCw />Refresh data</CommandItem>
            <CommandItem value="action home" onSelect={() => navigate('home')}><Home />Go to overview</CommandItem>
            <CommandItem value="action theme dark light" onSelect={() => { setDarkMode((current) => !current); setPaletteOpen(false) }}>{darkMode ? <Sun /> : <Moon />}{darkMode ? 'Switch to light theme' : 'Switch to dark theme'}</CommandItem>
            <CommandItem value="action logout" onSelect={() => { setPaletteOpen(false); setConfirmAction('logout') }}><LogOut />Log out</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
    <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>About Purchase Sale Office</DialogTitle><DialogDescription>Company details saved for this office workspace.</DialogDescription></DialogHeader>
        <CompanyBusinessCard company={companyProfile} logo={companyLogo} />
        <p className="text-center text-xs text-muted-foreground">Purchase Sale Office · Local SQLite desktop application</p>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmAction === 'logout' ? 'Log out of this office session?' : 'Quit Purchase Sale Office?'}</AlertDialogTitle><AlertDialogDescription>{confirmAction === 'logout' ? `You will be signed out as ${session.username}. Unsaved form changes may be lost.` : 'The application will close. Any unsaved form changes may be lost.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmAction(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const action = confirmAction; setConfirmAction(null); if (action === 'logout') void window.office.auth.logout().then(() => { setSession(null); setPage('home'); setHistory(['home']); setHistoryIndex(0) }).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not log out')); else if (action === 'quit') void window.office.app.quit() }}>{confirmAction === 'logout' ? 'Log out' : 'Quit'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <Toaster richColors position="bottom-right" />
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-60">
      <ContextMenuLabel>Purchase Sale Office</ContextMenuLabel>
      <ContextMenuItem onClick={() => navigate('home')}><Home />Overview<ContextMenuShortcut>Alt+Home</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem onClick={() => { setPaletteQuery(''); setPaletteOpen(true) }}><Search />Global search<ContextMenuShortcut>Ctrl+K</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem onClick={() => navigate('keybindings')}><Keyboard />Keybindings<ContextMenuShortcut>F1</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => void refresh()} disabled={busy}><RefreshCw />Refresh data</ContextMenuItem>
      <ContextMenuItem onClick={() => runMenuAction('reload')}><RefreshCw />Reload application<ContextMenuShortcut>Ctrl+R</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={goBack} disabled={historyIndex === 0}><ArrowLeft />Back<ContextMenuShortcut>Alt+←</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem onClick={goForward} disabled={historyIndex >= history.length - 1}><ArrowRight />Forward<ContextMenuShortcut>Alt+→</ContextMenuShortcut></ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
}

function SignInPage({ setup, onSuccess }: { setup: boolean; onSuccess: (session: OfficeSession) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError('')
    try { onSuccess(setup ? await window.office.auth.setup({ username, password }) : await window.office.auth.login({ username, password })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in') }
    finally { setSubmitting(false) }
  }
  return <main className="grid min-h-screen place-items-center bg-muted/30 p-5"><Card className="w-full max-w-md"><CardHeader><div className="mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><WalletCards /></div><CardTitle>{setup ? 'Create the office administrator' : 'Sign in to Purchase Sale Office'}</CardTitle><CardDescription>{setup ? 'This is the first account and receives all available permissions. Store its password safely.' : 'Use your local office account to continue.'}</CardDescription></CardHeader><CardContent><form className="grid gap-4" onSubmit={(event) => void submit(event)}><Field label="User name" id="auth-username"><Input id="auth-username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></Field><Field label="Password" id="auth-password"><Input id="auth-password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Please wait…' : setup ? 'Create administrator' : 'Sign in'}</Button></form></CardContent></Card></main>
}

function CompanyProfilePage({ profile, onboarding, onSave }: { profile: CompanyProfile | null; onboarding: boolean; onSave: (value: CompanyProfile) => Promise<void> }) {
  const [values, setValues] = useState<CompanyProfile>(profile ?? { name: '', address: '', phone: '', fiscalYear: '', logoPath: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (profile) setValues(profile) }, [profile])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true)
    try { await onSave(values) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save company profile') } finally { setSaving(false) }
  }
  return <section className="mx-auto flex w-full max-w-4xl flex-col gap-5"><div><h1 className="text-2xl font-semibold tracking-tight">{onboarding ? 'Set up your office' : 'Company Profile'}</h1><p className="mt-1 text-sm text-muted-foreground">{onboarding ? 'Administrator setup · Enter your office identity before starting daily work.' : 'Maintain the company identity shown throughout the application.'}</p></div>
    {onboarding && <Card><CardHeader><CardTitle className="text-base">Administrator onboarding</CardTitle><CardDescription>Your administrator account is ready. Company name is required to complete first-run setup.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">After saving, set up Chart of Accounts, Items, and Banks before posting transactions. Use test data until the office approves its opening balances and workflow.</CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">Office details</CardTitle><CardDescription>Administrator-only settings, saved to this computer’s local office database and used on the dashboard and printouts.</CardDescription></CardHeader><CardContent><form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5"><FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Company name" id="company-name"><Input id="company-name" required maxLength={120} value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Phone" id="company-phone"><Input id="company-phone" type="tel" value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} /></Field><Field label="Fiscal year" id="company-year"><Input id="company-year" placeholder="For example: 2026–2027" value={values.fiscalYear} onChange={(event) => setValues((current) => ({ ...current, fiscalYear: event.target.value }))} /></Field><Field label="Logo image file (optional)" id="company-logo"><Input id="company-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; try { const logoPath = window.office.company.pathForFile(file); if (!logoPath) throw new Error('Could not read selected file path'); setValues((current) => ({ ...current, logoPath })) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not select logo') } }} /><p className="truncate text-xs text-muted-foreground">{values.logoPath || 'Choose a PNG, JPG, or WebP image.'}</p></Field><div className="sm:col-span-2"><Field label="Address" id="company-address"><Input id="company-address" value={values.address} onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))} /></Field></div></FieldGroup><div className="flex justify-end"><Button type="submit" disabled={saving || !values.name.trim()}>{saving ? 'Saving…' : onboarding ? 'Save and continue' : 'Save company profile'}</Button></div></form></CardContent></Card>
  </section>
}

function UserRightsPage({ currentUsername, users, onRefresh, onSave, onDelete }: { currentUsername: string; users: OfficeUser[]; onRefresh: () => void; onSave: (value: { username: string; password: string; permissions: string[] }) => Promise<void>; onDelete: (username: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const reset = () => { setUsername(''); setPassword(''); setPermissions([]); setEditing(false); setSheetOpen(false) }
  const selectUser = (user: OfficeUser) => { setUsername(user.username); setPassword(''); setPermissions(user.permissions); setEditing(true); setSheetOpen(true) }
  const newUser = () => { setUsername(''); setPassword(''); setPermissions([]); setEditing(false); setSheetOpen(true) }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try { await onSave({ username, password, permissions }); reset() }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save user') }
    finally { setSaving(false) }
  }
  async function remove() { try { await onDelete(username); reset() } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete user') } }
  return <section className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">User Rights</h1><p className="mt-1 text-sm text-muted-foreground">Manage local sign-in accounts and the pages each account may open.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw data-icon="inline-start" />Refresh</Button><Button size="sm" onClick={newUser}><Plus data-icon="inline-start" />New user</Button></div></div>
    <Card><CardHeader className="pb-3"><CardTitle className="text-base">Office users</CardTitle><CardDescription>Select a user to edit their account and page access.</CardDescription></CardHeader><CardContent className="pt-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>User name</TableHead><TableHead>Accessible pages</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{users.map((user) => <TableRow key={user.username}><TableCell className="font-medium">{user.username}{user.username === currentUsername && <Badge className="ml-2" variant="secondary">You</Badge>}</TableCell><TableCell>{user.permissions.length}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => selectUser(user)}>Edit rights</Button></TableCell></TableRow>)}{!users.length && <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">No users.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <p className="text-xs text-muted-foreground">Passwords are stored as salted PBKDF2 hashes. Page access is checked by the Electron data bridge as well as navigation.</p>
    <Sheet open={sheetOpen} onOpenChange={(open) => { setSheetOpen(open); if (!open) { setUsername(''); setPassword(''); setPermissions([]); setEditing(false) } }}>
      <SheetContent side="right" className="flex data-[side=right]:w-[min(94vw,38rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b px-6 py-5"><SheetTitle>{editing ? `Edit ${username}` : 'Create office user'}</SheetTitle><SheetDescription>{editing ? 'Update this account’s page access. Leave password blank to keep the current password.' : 'Create a local sign-in account and choose the pages it may access.'}</SheetDescription></SheetHeader>
        <form onSubmit={(event) => void save(event)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><FieldGroup>
            <Field label="User name" id="user-rights-name"><Input id="user-rights-name" autoComplete="username" required maxLength={80} value={username} disabled={editing} onChange={(event) => setUsername(event.target.value)} /></Field>
            <Field label={editing ? 'New password (optional)' : 'Password'} id="user-rights-password"><Input id="user-rights-password" type="password" autoComplete="new-password" minLength={editing && !password ? undefined : 8} required={!editing} value={password} onChange={(event) => setPassword(event.target.value)} /><p className="text-xs text-muted-foreground">Passwords must contain at least 8 characters.</p></Field>
            <FieldSet className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <FieldLegend className="col-span-full" variant="label">Page access</FieldLegend>
              {permissionPages.map((key) => <label key={key} className="flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm"><input className="size-4 accent-primary" type="checkbox" checked={permissions.includes(pageNames[key])} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, pageNames[key]] : current.filter((entry) => entry !== pageNames[key]))} />{pageNames[key]}</label>)}
            </FieldSet>
          </FieldGroup></div>
          <SheetFooter className="mt-0 flex-row flex-wrap justify-between border-t px-6 py-4">
            {editing && username !== currentUsername ? <Button type="button" variant="destructive" onClick={() => { if (window.confirm(`Delete user ${username}?`)) void remove() }}>Delete user</Button> : <span />}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={reset}>Cancel</Button><Button type="submit" disabled={saving || !username || !permissions.some((permission) => !['Overview', 'Manual'].includes(permission)) || (!editing && password.length < 8)}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}</Button></div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  </section>
}

function AuditLogPage({ events, onRefresh }: { events: AuditEvent[]; onRefresh: () => void }) {
  const [filter, setFilter] = useState('')
  const visible = events.filter((event) => `${event.eventTime} ${event.username} ${event.action} ${event.details}`.toLowerCase().includes(filter.toLowerCase()))
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1><p className="mt-1 text-sm text-muted-foreground">Recent sign-ins and data changes recorded in this local database.</p></div><div className="flex gap-2"><Input className="w-56" placeholder="Filter audit entries" value={filter} onChange={(event) => setFilter(event.target.value)} /><Button variant="outline" onClick={onRefresh}><RefreshCw data-icon="inline-start" />Refresh</Button></div></div><Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Details</TableHead></TableRow></TableHeader><TableBody>{visible.map((event, index) => <TableRow key={`${event.eventTime}-${event.action}-${index}`}><TableCell className="whitespace-nowrap tabular-nums">{new Date(event.eventTime).toLocaleString()}</TableCell><TableCell>{event.username}</TableCell><TableCell><Badge variant="secondary">{event.action}</Badge></TableCell><TableCell>{event.details || '—'}</TableCell></TableRow>)}{!visible.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{filter ? 'No audit entries match that filter.' : 'No audit events have been recorded.'}</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card><p className="text-xs text-muted-foreground">Showing up to the latest 1,000 events. The log is read-only from this screen.</p></section>
}

function StockTypesPage({ rows, onSave, onDelete }: { rows: StockType[]; onSave: (value: StockType) => Promise<void>; onDelete: (code: string) => Promise<void> }) {
  const [code, setCode] = useState(''); const [description, setDescription] = useState(''); const [editing, setEditing] = useState(false); const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [deleteCode, setDeleteCode] = useState<string | null>(null)
  const reset = () => { setCode(''); setDescription(''); setEditing(false); setOpen(false) }
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); try { await onSave({ code: code.trim().toUpperCase(), description: description.trim() }); reset() } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save stock type') } finally { setSaving(false) } }
  function edit(row: StockType) { setCode(row.code); setDescription(row.description); setEditing(true); setOpen(true) }
  function create() { setCode(''); setDescription(''); setEditing(false); setOpen(true) }
  return <section className="flex flex-col gap-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Stock Types</h1><p className="mt-1 text-sm text-muted-foreground">Manage the classifications available in the Item master.</p></div><Button onClick={create}><Plus data-icon="inline-start" />Add stock type</Button></div><Card><CardHeader className="pb-3"><CardTitle className="text-base">Available stock types</CardTitle><CardDescription>{rows.length} type{rows.length === 1 ? '' : 's'} · Built-in REG and SER types cannot be deleted.</CardDescription></CardHeader><CardContent className="pt-0"><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Description</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.code}><TableCell className="font-medium">{row.code}</TableCell><TableCell>{row.description}</TableCell><TableCell className="whitespace-nowrap"><Button variant="ghost" size="sm" onClick={() => edit(row)}>Edit</Button><Button variant="ghost" size="sm" disabled={['REG', 'SER'].includes(row.code)} onClick={() => setDeleteCode(row.code)}>Delete</Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">No stock types.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Sheet open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset() }}><SheetContent side="right" className="flex data-[side=right]:w-[min(92vw,36rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>{editing ? `Edit ${code}` : 'Add stock type'}</SheetTitle><SheetDescription>Set the code and description used by item records.</SheetDescription></SheetHeader><form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col"><FieldGroup className="flex-1 content-start overflow-y-auto p-6"><Field label="Stock type code" id="stock-type-code"><Input id="stock-type-code" required maxLength={20} disabled={editing} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></Field><Field label="Description" id="stock-type-description"><Input id="stock-type-description" required maxLength={100} value={description} onChange={(event) => setDescription(event.target.value)} /></Field></FieldGroup><SheetFooter className="mt-0 flex-row justify-end border-t px-6 py-4"><Button type="button" variant="outline" onClick={reset}>Cancel</Button><Button disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add stock type'}</Button></SheetFooter></form></SheetContent></Sheet>
    <AlertDialog open={deleteCode !== null} onOpenChange={(value) => { if (!value) setDeleteCode(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete stock type {deleteCode}?</AlertDialogTitle><AlertDialogDescription>A type assigned to any item cannot be deleted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const target = deleteCode; if (target) void onDelete(target).then(() => toast.success('Stock type deleted')).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not delete stock type')).finally(() => setDeleteCode(null)) }}>Delete type</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}

function OpeningBalancesPage({ rows, items, locations, onAdd }: { rows: OpeningBalance[]; items: Item[]; locations: string[]; onAdd: (value: { itemCode: string; location: string; quantity: number }) => Promise<void> }) {
  const [itemCode, setItemCode] = useState(''); const [location, setLocation] = useState(locations[0] ?? ''); const [quantity, setQuantity] = useState(''); const [saving, setSaving] = useState(false); const [editorOpen, setEditorOpen] = useState(false)
  const selectedItem = items.find((item) => item.code === itemCode)
  useEffect(() => { if (!location && locations[0]) setLocation(locations[0]) }, [location, locations])
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); try { await onAdd({ itemCode, location, quantity: Number(quantity) }); setQuantity(''); setItemCode(''); setEditorOpen(false) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not add opening balance') } finally { setSaving(false) } }
  return <section className="flex flex-col gap-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Item Opening Balances</h1><p className="mt-1 text-sm text-muted-foreground">Record starting stock as an auditable inventory movement.</p></div><Button onClick={() => setEditorOpen(true)} disabled={!items.length}><Plus data-icon="inline-start" />Add opening balance</Button></div><Card><CardHeader><CardTitle className="text-base">Recorded opening movements</CardTitle><CardDescription>{rows.length} entry{rows.length === 1 ? '' : 'ies'} · each saved entry contributes to location stock</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Item</TableHead><TableHead>Location</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{row.date}</TableCell><TableCell>{row.itemCode} — {row.itemDescription ?? 'Unknown item'}</TableCell><TableCell>{row.location}</TableCell><TableCell className="text-right tabular-nums">{row.quantity}</TableCell><TableCell className="text-right tabular-nums">{money(row.rate)}</TableCell><TableCell className="text-right tabular-nums">{money(row.amount)}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No opening balances recorded.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="right" className="flex data-[side=right]:w-[min(92vw,38rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>Add opening stock</SheetTitle><SheetDescription>Rate is automatically taken from the selected item’s current purchase rate. Quantity must be positive.</SheetDescription></SheetHeader><form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col"><FieldGroup className="min-h-0 flex-1 content-start overflow-y-auto p-6"><Field label="Item" id="opening-item"><FormSelect id="opening-item" value={itemCode} onChange={setItemCode} placeholder="Select an item" options={items.map((item) => ({ value: item.code, label: `${item.code} — ${item.description}` }))} /></Field><Field label="Location" id="opening-location"><Input id="opening-location" list="opening-locations" required value={location} onChange={(event) => setLocation(event.target.value)} /><datalist id="opening-locations">{locations.map((place) => <option key={place} value={place} />)}</datalist></Field><Field label="Opening quantity" id="opening-quantity"><Input id="opening-quantity" type="number" min="0.000001" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><Field label="Opening rate" id="opening-rate"><Input id="opening-rate" disabled value={selectedItem ? money(selectedItem.purchaseRate) : ''} placeholder="Selected item rate" /></Field></FieldGroup><SheetFooter className="mt-0 flex-row justify-end border-t px-6 py-4"><Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !items.length || !itemCode}>{saving ? 'Saving…' : 'Save opening balance'}</Button></SheetFooter></form></SheetContent></Sheet>
  </section>
}

function TransferPage({ items, locations, movements, onTransfer }: { items: Item[]; locations: string[]; movements: StockMovement[]; onTransfer: (value: { itemCode: string; fromLocation: string; toLocation: string; quantity: number }) => Promise<void> }) {
  const [itemCode, setItemCode] = useState(''); const [fromLocation, setFromLocation] = useState(''); const [toLocation, setToLocation] = useState(''); const [quantity, setQuantity] = useState(''); const [available, setAvailable] = useState<number | null>(null); const [saving, setSaving] = useState(false); const [editorOpen, setEditorOpen] = useState(false)
  useEffect(() => { let active = true; if (itemCode && fromLocation) void window.office.stock.quantity(itemCode, fromLocation).then((value) => { if (active) setAvailable(value) }).catch(() => { if (active) setAvailable(null) }); else setAvailable(null); return () => { active = false } }, [itemCode, fromLocation])
  const transferRows = movements.filter((movement) => movement.type.startsWith('TRANSFER'))
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); try { await onTransfer({ itemCode, fromLocation, toLocation, quantity: Number(quantity) }); setQuantity(''); setItemCode(''); setFromLocation(''); setToLocation(''); setEditorOpen(false) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not transfer stock') } finally { setSaving(false) } }
  return <section className="flex flex-col gap-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Transfer</h1><p className="mt-1 text-sm text-muted-foreground">Move available quantity between locations without changing total office stock.</p></div><Button onClick={() => setEditorOpen(true)} disabled={!items.length || !locations.length}><Plus data-icon="inline-start" />Transfer stock</Button></div><Card><CardHeader><CardTitle className="text-base">Recent transfer movements</CardTitle><CardDescription>Each transfer appears as one outbound and one inbound stock movement.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Transfer ID</TableHead><TableHead>Item</TableHead><TableHead>Location</TableHead><TableHead>Movement</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader><TableBody>{transferRows.map((row) => <TableRow key={row.id}><TableCell>{row.date}</TableCell><TableCell>{row.document}</TableCell><TableCell>{row.itemCode}</TableCell><TableCell>{row.location}</TableCell><TableCell>{row.type}</TableCell><TableCell className="text-right tabular-nums">{row.quantity}</TableCell></TableRow>)}{!transferRows.length && <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No transfers have been recorded.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card><Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="right" className="flex data-[side=right]:w-[min(92vw,38rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>Transfer item stock</SheetTitle><SheetDescription>Both location movements save together. The destination must differ from the source.</SheetDescription></SheetHeader><form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col"><FieldGroup className="min-h-0 flex-1 content-start gap-5 overflow-y-auto p-6"><Field label="Item" id="transfer-item"><FormSelect id="transfer-item" value={itemCode} onChange={setItemCode} placeholder="Select an item" options={items.map((item) => ({ value: item.code, label: `${item.code} — ${item.description}` }))} /></Field><Field label="From location" id="transfer-from"><FormSelect id="transfer-from" value={fromLocation} onChange={setFromLocation} placeholder="Select source" options={locations.map((place) => ({ value: place, label: place }))} /></Field><Field label="To location" id="transfer-to"><Input id="transfer-to" list="transfer-locations" required value={toLocation} onChange={(event) => setToLocation(event.target.value)} placeholder="Destination" /><datalist id="transfer-locations">{locations.map((place) => <option key={place} value={place} />)}</datalist></Field><Field label="Quantity" id="transfer-quantity"><Input id="transfer-quantity" type="number" min="0.000001" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><p className="text-sm text-muted-foreground">Available at source: <strong className="text-foreground tabular-nums">{available === null ? 'Select item and location' : available}</strong></p></FieldGroup><SheetFooter className="mt-0 flex-row justify-end border-t px-6 py-4"><Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !itemCode || !fromLocation || !toLocation || fromLocation === toLocation || !quantity}>{saving ? 'Transferring…' : 'Transfer stock'}</Button></SheetFooter></form></SheetContent></Sheet></section>
}

function SettingsPage({ darkMode, onThemeChange }: { darkMode: boolean; onThemeChange: (dark: boolean) => void }) {
  const [pageSize, setPageSize] = useState(readTablePageSize)
  const updatePageSize = (value: string) => {
    const next = Number(value)
    if (!TABLE_PAGE_SIZE_OPTIONS.includes(next as (typeof TABLE_PAGE_SIZE_OPTIONS)[number])) return
    setPageSize(next)
    saveTablePageSize(next)
  }
  return <section className="mx-auto flex w-full max-w-3xl flex-col gap-5"><div><h1 className="text-2xl font-semibold tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Preferences for this Windows or Linux user account. These do not change office records.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Appearance and tables</CardTitle><CardDescription>Preferences are saved on this computer and applied throughout the app.</CardDescription></CardHeader><CardContent><FieldGroup className="gap-6">
      <Field label="Color theme" id="settings-theme"><div className="flex flex-wrap items-center gap-3"><Button id="settings-theme" type="button" variant="outline" aria-pressed={darkMode} onClick={() => onThemeChange(!darkMode)}>{darkMode ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}{darkMode ? 'Use light theme' : 'Use dark theme'}</Button><span className="text-sm text-muted-foreground">Current theme: {darkMode ? 'Dark' : 'Light'}</span></div></Field>
      <Field label="Items per table page" id="settings-page-size"><Select value={String(pageSize)} onValueChange={(value) => { if (value) updatePageSize(value) }}><SelectTrigger id="settings-page-size" className="h-9 w-full max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{TABLE_PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={String(size)}>{size} rows</SelectItem>)}</SelectGroup></SelectContent></Select><p className="text-xs text-muted-foreground">Applies to shared table search and pagination. Default: 25 rows.</p></Field>
    </FieldGroup></CardContent></Card>
  </section>
}

export function ManualPage() {
  return <section className="mx-auto max-w-4xl space-y-5"><div><h1 className="text-2xl font-semibold tracking-tight">User Manual</h1><p className="mt-1 text-sm text-muted-foreground">Practical reference for everyday office work.</p></div><Card><CardHeader><CardTitle className="text-base">Navigation and search</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Use the left navigation for pages. The toolbar’s Home and Manual buttons return to the overview or this reference.</p><p>Use Search or press <kbd className="rounded border px-1.5 py-0.5">Ctrl+K</kbd> to find pages and records. Search matches account, item, bank, challan, and cheque labels already loaded from the local database.</p><p>Back and Forward buttons move through pages visited in this session. Keyboard shortcuts: <kbd className="rounded border px-1.5 py-0.5">Alt+←</kbd> and <kbd className="rounded border px-1.5 py-0.5">Alt+→</kbd>.</p></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Daily data entry</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Maintain accounts, items, and banks before using them on transactions. Item rates are read from the item master when a challan line is selected.</p><p>Purchase challans increase stock at the selected location; sale challans reduce it. A sale that exceeds available stock is rejected. Confirm the party, date, location, and item quantities before posting.</p><p>Cheque records refer to a bank and a party account. Review the status and check number before saving.</p></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Accounts, passwords, and audit</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>The first app launch asks you to create an administrator. Create separate accounts for other operators in User Rights and grant only the pages each person needs.</p><p>Passwords are stored using salted PBKDF2. Sign out when leaving a shared computer. Audit Log shows recent sign-ins, saves, updates, deletions, and transaction postings; it is read-only.</p><p>Data is stored in the local SQLite database on this computer. Back up that database before moving or replacing it; do not copy it while the app is open.</p></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Important limits</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>This app is not yet a replacement for a verified migration from the legacy office system. Do not treat generated reports or example workflows as a reconciliation with legacy books.</p><p>Global search only searches data currently loaded for the visible application modules. It does not search deleted records or the audit log.</p></CardContent></Card></section>
}

function KeybindingsPage() {
  return <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">Keyboard shortcuts</h1><p className="mt-1 text-sm text-muted-foreground">Application commands work throughout the signed-in workspace. On macOS, Ctrl means Command.</p></div>
    <Card><CardHeader><CardTitle className="text-base">Application and editing shortcuts</CardTitle><CardDescription>Shortcuts for navigation, search, display, and common text editing.</CardDescription></CardHeader><CardContent className="divide-y">
      {APP_KEYBINDINGS.map(({ keys, action, description }) => <div key={action} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><span className="text-sm">{description}</span><kbd className="rounded-md border bg-muted px-2 py-1 font-mono text-xs text-foreground">{keys}</kbd></div>)}
    </CardContent></Card>
    <p className="text-xs text-muted-foreground">Right-click anywhere in the app for navigation and refresh actions. Shortcuts are intercepted by the application, so Ctrl+R reloads this app rather than the browser shell.</p>
  </section>
}

function ReferenceManualPage() {
  return <section className="mx-auto max-w-5xl space-y-5"><div><h1 className="text-2xl font-semibold tracking-tight">User Manual</h1><p className="mt-1 text-sm text-muted-foreground">A practical reference for setup, daily entry, corrections, and data safety.</p></div>
    <Card><CardHeader><CardTitle className="text-base">First use and navigation</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Create the first administrator on first launch. Use a unique username and password of at least eight characters. The app then requires company name, address, phone, fiscal year, and optional logo path before opening the workspace. Company Profile remains available later to authorized administrators. Create separate operator accounts in User Rights and grant only the pages they need. Sign out on shared computers.</p><p>Use the conventional File, Edit, View, Masters, Transactions, Reports, Administration, and Help menus. Toolbar back/forward follows pages visited in this session; Home returns to the dashboard; Ctrl+K opens global search and commands; Alt+Left/Right navigates history.</p><p>The light/dark setting is saved on this computer and does not change office data.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Initial data setup</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Set up Chart of Accounts first: create parent accounts before child accounts. Add the account named “Party” and its party/customer/supplier children if these are to appear in transaction selectors. “Cash in Hand” is also offered. Then create Items with item code, unit, stock type, purchase rate, and sale rate. Create Banks before entering cheques.</p><p>Generated IDs are disabled in forms and assigned by the application. Confirm an ID before saving; edit the record later rather than trying to type a different generated ID. Referenced master records may not be deletable until dependent data is removed.</p><p>Opening Balances records starting quantities by item and location, valued at each item’s current purchase rate. It does not import legacy records automatically. Stock Transfers move a positive quantity between two different locations and require enough stock at the source. Test starting quantities in a separate database before office use.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Purchase and sale challans</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Choose New challan, verify the generated number, date, party, and location, then add item lines. Select an item and enter a positive quantity. Rate and amount come from the current item master; check the total before posting. A purchase increases stock at its location and a sale decreases it. Sales that exceed available stock are rejected.</p><p>Edit opens the saved lines. Saving an edit recalculates rates from current master rates, so a change to an item’s rate can change an old challan’s total. Deleting a challan is permanent. Deleting or editing a purchase is refused when resulting stock for an affected item/location would become negative. Use the error message to identify the stock issue before retrying.</p><p>Audit Log records post/update/delete events, but it is not a revision history and cannot restore old values. Reports recalculate from current saved challans.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Cheque detail and user access</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Enter a generated Cheque ID, optional Check Number, bank, cheque date, party, positive amount, and status. Existing records can be edited or deleted. Deleting a cheque removes its status history and records a deletion audit event.</p><p>User Rights creates accounts, changes page access, and optionally resets a password. Keep at least one administrator with User Rights access. Passwords are stored as salted PBKDF2 hashes. Audit Log displays the latest 1,000 events and is read-only in the app; it is not tamper-proof or an external compliance archive.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Vouchers, payments, and receipts</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Voucher and Journal Voucher both post balanced double-entry records. Select at least two account lines; each line must have a debit or a credit, never both. Total debits must equal total credits. The generated voucher number is read-only. Saved vouchers can be edited or deleted; these changes are audited.</p><p>Payment / Receipt is a shorter form that writes the corresponding two balanced lines between the selected party account and cash/bank account. Search Payment filters posted payments and receipts by dates or matching text. The payment screen does not allocate amounts to individual challans/invoices, and posting a purchase/sale challan does not automatically create a voucher. Reconcile these workflows with the office before relying on account balances.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Reports and interpretation</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Use the Reports menu, Ctrl+K, or the selector to open the Java report names: stock/Transit, purchase/sales registers, voucher/ledger, party/item, cheque, profitability, and balance reports. Date and text filters, CSV export, and print are available. Stock reports use saved opening movements, challans, and transfers.</p><p>Receivable, Payable, and Aging screens cannot calculate reliable balances until invoice due dates and payment allocations are recorded. Balance Sheet and Profit & Loss are not formal statements because accounts are unclassified and challans do not create accounting entries. Profitability is only sales less purchases, not cost-of-goods-sold. Reports exclude external legacy transactions and are not audited statements; compare test totals with an authorized source before relying on them.</p></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Database, backups, and troubleshooting</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Data is stored in a local SQLite file. Windows default: <code className="rounded bg-muted px-1">%LOCALAPPDATA%\PurchaseSaleOffice\data\purchase-sale.sqlite</code>. Linux uses Electron’s per-user application data directory.</p><p>Open File → Database tools or Administration → Database Tools. Create backup writes a consistent SQLite snapshot to the app data folder’s <code className="rounded bg-muted px-1">backups</code> directory while the app is open. Copy that completed snapshot to separate storage. Export office data saves readable JSON records to a chosen path; it is not a database restore file and omits passwords. Verify database checks SQLite integrity and foreign-key references; it does not repair damage.</p><p>Restore only when needed: close the app, preserve the current database under a different name, replace it with a verified backup, reopen the app, and inspect records. Never share one SQLite file across PCs or open separate copies expecting changes to merge; this build does not synchronize concurrent users’ changes across machines.</p><p>If verification fails or totals look wrong, stop data entry and create a backup before troubleshooting. Office testing should use a separate database and compare transactions and totals against authorized examples.</p></CardContent></Card>
  </section>
}

function DashboardPage({ dashboard, onNavigate, allowedPages, username }: { dashboard: Dashboard | null; onNavigate: (page: Page) => void; allowedPages: Page[]; username: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer) }, [])
  const greeting = karachiGreeting(now)
  const karachiDate = new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now)
  const karachiTime = new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' }).format(now)
  const stats = [
    { label: 'Accounts', value: dashboard?.counts.accounts ?? '—', icon: Building2 },
    { label: 'Items', value: dashboard?.counts.items ?? '—', icon: Package },
    { label: 'Purchases today', value: dashboard ? money(dashboard.counts.purchasesToday) : '—', icon: ArrowDownToLine },
    { label: 'Sales today', value: dashboard ? money(dashboard.counts.salesToday) : '—', icon: ArrowUpFromLine },
  ]
  return <section className="flex flex-col gap-5">
    <section className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">{karachiDate} · {karachiTime} PKT</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{greeting}, {username}</h1><p className="mt-1 text-sm text-muted-foreground">Here is the current activity in your office.</p></div><Badge variant="secondary" className="gap-1.5"><Activity className="size-3.5" /> Offline-ready</Badge></section>
    <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="flex items-center justify-between p-6"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div><div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></div></CardContent></Card>)}</section>
    {dashboard && [{ page: 'accounts' as const, label: 'Create your account structure', done: dashboard.counts.accounts > 0 }, { page: 'items' as const, label: 'Add the items you handle', done: dashboard.counts.items > 0 }, { page: 'banks' as const, label: 'Add a bank (if used)', done: dashboard.counts.banks > 0 }].some((task) => !task.done && allowedPages.includes(task.page)) && <Card><CardHeader><CardTitle className="text-base">Getting started</CardTitle><CardDescription>Optional setup checklist for this office database. It does not create sample records.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{[{ page: 'accounts' as const, label: 'Create your account structure', done: dashboard.counts.accounts > 0 }, { page: 'items' as const, label: 'Add the items you handle', done: dashboard.counts.items > 0 }, { page: 'banks' as const, label: 'Add a bank (if used)', done: dashboard.counts.banks > 0 }].filter((task) => !task.done && allowedPages.includes(task.page)).map((task) => <Button key={task.page} variant="outline" onClick={() => onNavigate(task.page)}>{task.label}</Button>)}</CardContent></Card>}
    <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Card><CardHeader><CardTitle className="text-base">Recent challans</CardTitle><CardDescription>Latest purchase and sale documents recorded here.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{(dashboard?.recent ?? []).map((row) => <TableRow key={row.number}><TableCell><div className="font-medium">{row.number}</div><div className="text-xs text-muted-foreground">{row.type}</div></TableCell><TableCell>{row.date}</TableCell><TableCell>{row.party}</TableCell><TableCell className="text-right tabular-nums">{money(row.total)}</TableCell></TableRow>)}{!dashboard?.recent.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No challans recorded yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Quick actions</CardTitle><CardDescription>Start a common office task.</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">{[{ page: 'purchase' as const, label: 'New purchase challan', icon: ArrowDownToLine }, { page: 'sale' as const, label: 'New sale challan', icon: ArrowUpFromLine }, { page: 'accounts' as const, label: 'Manage accounts', icon: Building2 }, { page: 'items' as const, label: 'Manage items', icon: Package }].filter(({ page }) => allowedPages.includes(page)).map(({ page, label, icon: Icon }) => <Button key={page} variant="outline" className="justify-start" onClick={() => onNavigate(page)}><Icon className="mr-2 size-4" />{label}</Button>)}</CardContent></Card>
    </section>
    <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">Stock position</p><p className="text-sm text-muted-foreground">Net available units across recorded locations</p></div><p className="text-xl font-semibold tabular-nums">{dashboard ? money(dashboard.stockQuantity) : '—'}</p></CardContent></Card>
  </section>
}

function CompanyBusinessCard({ company, logo }: { company: CompanyProfile | null; logo: string | null }) {
  const name = company?.name.trim() || 'Company profile not set up'
  const details = [company?.address.trim(), company?.phone.trim(), company?.fiscalYear.trim()].filter((value): value is string => Boolean(value))
  return <Card className="w-full overflow-hidden border-primary/20 bg-gradient-to-br from-card to-muted/60">
    <CardHeader className="flex-row items-center justify-between gap-4 pb-3">
      <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Office profile</p><CardTitle className="mt-1 truncate text-lg">{name}</CardTitle></div>
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border bg-background text-primary shadow-sm">
        {logo ? <img src={logo} alt={`${name} logo`} className="size-full object-contain p-1.5" /> : <Building2 className="size-7" />}
      </div>
    </CardHeader>
    <CardContent className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
      {details.length ? details.map((detail, index) => <span key={`${index}-${detail}`} className="max-w-full truncate">{detail}</span>) : <span>Add address, phone, and fiscal year in Company Profile.</span>}
    </CardContent>
  </Card>
}

function MasterPage({ title, description, search, onSearch, children }: { title: string; description: string; search: string; onSearch: (value: string) => void; children: React.ReactNode }) {
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search records" value={search} onChange={(event) => onSearch(event.target.value)} /></div></div>{children}</section>
}

type AccountTreeRow = { account: Account; depth: number; hasChildren: boolean }
function buildAccountTree(accounts: Account[], query: string): AccountTreeRow[] {
  const matches = new Set(accounts.filter((account) => `${account.code} ${account.description}`.toLowerCase().includes(query.trim().toLowerCase())).map((account) => account.code))
  const included = new Set(matches)
  for (const account of accounts) {
    if (!matches.has(account.code)) continue
    let parentCode = account.parentCode
    while (parentCode && !included.has(parentCode)) {
      included.add(parentCode)
      parentCode = accounts.find((candidate) => candidate.code === parentCode)?.parentCode ?? null
    }
  }
  const children = new Map<string, Account[]>()
  for (const account of accounts) {
    if (!included.has(account.code) || !account.parentCode || !accounts.some((candidate) => candidate.code === account.parentCode)) continue
    children.set(account.parentCode, [...(children.get(account.parentCode) ?? []), account])
  }
  const visible: AccountTreeRow[] = []
  const visited = new Set<string>()
  const visit = (account: Account, depth: number) => {
    if (visited.has(account.code)) return
    visited.add(account.code)
    const descendants = children.get(account.code) ?? []
    visible.push({ account, depth, hasChildren: descendants.length > 0 })
    for (const child of descendants) visit(child, depth + 1)
  }
  for (const account of accounts) {
    if (included.has(account.code) && (!account.parentCode || !accounts.some((candidate) => candidate.code === account.parentCode))) visit(account, 0)
  }
  for (const account of accounts) if (included.has(account.code) && !visited.has(account.code)) visit(account, 0)
  return visible
}

function AccountsTable({ accounts, query, onSave, onDelete }: { accounts: Account[]; query: string; onSave: (value: Account) => Promise<void>; onDelete: (code: string) => Promise<void> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => { setCollapsed(new Set()) }, [query])
  const treeRows = buildAccountTree(accounts, query)
  const shownRows: AccountTreeRow[] = []
  const hiddenByCollapsedParent = new Set<string>()
  for (const row of treeRows) {
    if (row.account.parentCode && hiddenByCollapsedParent.has(row.account.parentCode)) hiddenByCollapsedParent.add(row.account.code)
    else shownRows.push(row)
    if (row.hasChildren && collapsed.has(row.account.code)) hiddenByCollapsedParent.add(row.account.code)
  }
  const rows = shownRows.map(({ account }) => [account.code, account.description, accounts.find((parent) => parent.code === account.parentCode)?.description ?? '—', money(account.openingBalance)])
  const records = shownRows.map(({ account }) => ({ code: account.code, description: account.description, parentCode: account.parentCode ?? '', openingBalance: String(account.openingBalance) }))
  return <MasterTable idKind="account" title="Accounts" createLabel="Add account" columns={['Code', 'Description', 'Parent account', 'Opening balance', '']} rows={rows} records={records} treeRows={shownRows.map(({ account, depth, hasChildren }) => ({ code: account.code, depth, hasChildren, collapsed: collapsed.has(account.code), onToggle: () => setCollapsed((current) => { const next = new Set(current); if (next.has(account.code)) next.delete(account.code); else next.add(account.code); return next }) }))} fields={[{ key: 'code', label: 'Account code', auto: true }, { key: 'description', label: 'Description' }, { key: 'parentCode', label: 'Parent account', type: 'select', options: [{ value: '', label: 'Top-level account' }, ...accounts.map((account) => ({ value: account.code, label: `${account.code} — ${account.description}` }))] }, { key: 'openingBalance', label: 'Opening balance', type: 'number' }]} onSave={async (value) => onSave({ code: value.code, description: value.description, parentCode: value.parentCode || null, openingBalance: Number(value.openingBalance) })} onDelete={(index) => onDelete(shownRows[index].account.code)} />
}
function ItemsTable({ rows, stockTypes, onSave, onDelete }: { rows: Item[]; stockTypes: StockType[]; onSave: (value: Item) => Promise<void>; onDelete: (code: string) => Promise<void> }) {
  return <MasterTable idKind="item" title="Items" createLabel="Add item" columns={['Code', 'Description', 'Unit', 'Stock type', 'Purchase rate', 'Sale rate', '']} rows={rows.map((row) => [row.code, row.description, row.unit, stockTypes.find((type) => type.code === row.stockType)?.description ?? row.stockType, money(row.purchaseRate), money(row.saleRate)])} records={rows.map((row) => ({ ...row, saleRate: String(row.saleRate), purchaseRate: String(row.purchaseRate) }))} fields={[{ key: 'code', label: 'Item code', auto: true }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unit' }, { key: 'stockType', label: 'Stock type', type: 'select', options: stockTypes.map((type) => ({ value: type.code, label: `${type.code} — ${type.description}` })) }, { key: 'purchaseRate', label: 'Purchase rate', type: 'number' }, { key: 'saleRate', label: 'Sale rate', type: 'number' }]} onSave={async (value) => onSave({ code: value.code, description: value.description, unit: value.unit, stockType: value.stockType, purchaseRate: Number(value.purchaseRate), saleRate: Number(value.saleRate) })} onDelete={(index) => onDelete(rows[index].code)} />
}
function BanksTable({ rows, onSave, onDelete }: { rows: Bank[]; onSave: (value: Bank) => Promise<void>; onDelete: (code: string) => Promise<void> }) {
  return <MasterTable idKind="bank" title="Banks" createLabel="Add bank" columns={['Code', 'Bank name', 'Account number', 'Opening balance', '']} rows={rows.map((row) => [row.code, row.name, row.accountNumber || '—', money(row.openingBalance)])} records={rows.map((row) => ({ ...row, openingBalance: String(row.openingBalance) }))} fields={[{ key: 'code', label: 'Bank code', auto: true }, { key: 'name', label: 'Bank name' }, { key: 'accountNumber', label: 'Account number' }, { key: 'openingBalance', label: 'Opening balance', type: 'number' }, { key: 'address', label: 'Address' }, { key: 'phone', label: 'Phone' }]} onSave={async (value) => onSave({ code: value.code, name: value.name, accountNumber: value.accountNumber, openingBalance: Number(value.openingBalance), address: value.address, phone: value.phone })} onDelete={(index) => onDelete(rows[index].code)} />
}

type EditorField = { key: string; label: string; type?: 'text' | 'number' | 'select'; auto?: boolean; options?: Array<{ value: string; label: string }> }
function FormSelect({ id, value, onChange, options, placeholder }: { id?: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder: string }) {
  return <Select value={value || null} onValueChange={(next) => onChange(next ?? '')}><SelectTrigger id={id} className="h-9 w-full"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent><SelectGroup>{options.filter((option) => option.value !== '').map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
}
type TreeRowControl = { code: string; depth: number; hasChildren: boolean; collapsed: boolean; onToggle: () => void }
function MasterTable({ idKind, title, createLabel, columns, rows, records, fields, onSave, onDelete, treeRows }: { idKind: 'account' | 'item' | 'bank'; title: string; createLabel: string; columns: string[]; rows: string[][]; records: Array<Record<string, string>>; fields: EditorField[]; onSave: (value: Record<string, string>) => Promise<void>; onDelete: (index: number) => Promise<void>; treeRows?: TreeRowControl[] }) {
  const [open, setOpen] = useState(false); const [editIndex, setEditIndex] = useState<number | null>(null); const [values, setValues] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false)
  const startCreate = async () => { setEditIndex(null); const initial = Object.fromEntries(fields.map((field) => [field.key, field.type === 'select' ? field.options?.[0]?.value ?? '' : ''])); const idField = fields.find((field) => field.auto); if (idField) initial[idField.key] = await window.office.ids.next(idKind); setValues(initial); setOpen(true) }
  const startEdit = (index: number) => { setEditIndex(index); setValues({ ...records[index] }); setOpen(true) }
  const submit = async () => { setSaving(true); try { await onSave(values); toast.success('Saved'); setOpen(false) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save record') } finally { setSaving(false) } }
  return <>
    <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">{title}</CardTitle><CardDescription>{rows.length} record{rows.length === 1 ? '' : 's'}</CardDescription></div><Button onClick={() => void startCreate()}><Plus data-icon="inline-start" />{createLabel}</Button></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow>{columns.map((column, index) => <TableHead key={`${column}-${index}`}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={treeRows?.[index]?.code ?? row[0]}>{row.map((cell, cellIndex) => <TableCell key={cellIndex} className={cellIndex > 2 && cellIndex < row.length - 1 ? 'tabular-nums' : ''}>{cellIndex === 1 && treeRows ? <div className="flex items-center gap-1" style={{ paddingLeft: `${treeRows[index].depth * 22}px` }}>{treeRows[index].depth > 0 && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}{treeRows[index].hasChildren && <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={`${treeRows[index].collapsed ? 'Expand' : 'Collapse'} ${cell}`} aria-expanded={!treeRows[index].collapsed} onClick={treeRows[index].onToggle}>{treeRows[index].collapsed ? <ChevronRight /> : <ChevronDown />}</Button>}{!treeRows[index].hasChildren && treeRows[index].depth === 0 && <span className="w-7 shrink-0" />}{cell}</div> : cell}</TableCell>)}<TableCell className="w-28 text-right"><div className="inline-flex items-center justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => startEdit(index)}>Edit</Button><Button variant="ghost" size="icon-sm" aria-label={`Delete ${row[0]}`} onClick={() => { if (window.confirm(`Delete ${row[0]}?`)) void onDelete(index).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not delete record')) }}><Trash2 /></Button></div></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">No records yet. Use “{createLabel}” to add the first.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className="flex data-[side=right]:w-[min(92vw,36rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>{editIndex === null ? createLabel : `Edit ${title.toLowerCase().replace(/s$/, '')}`}</SheetTitle><SheetDescription>Complete the fields below. Changes save to this computer’s office database.</SheetDescription></SheetHeader><FieldGroup className="grid min-h-0 flex-1 content-start grid-cols-1 gap-x-5 gap-y-5 overflow-y-auto p-6 sm:grid-cols-2">{fields.map((field) => <UiField key={field.key}><FieldLabel htmlFor={`editor-${field.key}`}>{field.label}</FieldLabel>{field.type === 'select' ? <FormSelect id={`editor-${field.key}`} value={values[field.key] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} options={field.options ?? []} placeholder={field.options?.find((option) => !option.value)?.label ?? `Select ${field.label.toLowerCase()}`} /> : <Input id={`editor-${field.key}`} type={field.type ?? 'text'} disabled={field.auto} step={field.type === 'number' ? 'any' : undefined} value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}</UiField>)}</FieldGroup><SheetFooter className="mt-0 border-t px-6 py-4"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void submit()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></SheetFooter></SheetContent></Sheet>
  </>
}

function PrinterIcon() { return <Printer className="mr-2 size-4" /> }

function ChallanPage({ type, rows, items, accounts, locations, company, logo, onPost, onUpdate, onDelete }: { type: 'PURCHASE' | 'SALE'; rows: Challan[]; items: Item[]; accounts: Account[]; locations: string[]; company: CompanyProfile | null; logo: string | null; onPost: (value: { number: string; type: string; date: string; party: string; location: string; lines: Array<{ itemCode: string; quantity: number }> }) => Promise<void>; onUpdate: (value: { number: string; type: string; date: string; party: string; location: string; lines: Array<{ itemCode: string; quantity: number }> }) => Promise<void>; onDelete: (number: string) => Promise<void> }) {
  const [number, setNumber] = useState(''); const [date, setDate] = useState(today()); const [party, setParty] = useState(''); const [location, setLocation] = useState(locations[0] ?? 'Main');
  const [lines, setLines] = useState([{ itemCode: '', quantity: 1 }]); const [posting, setPosting] = useState(false); const [editorOpen, setEditorOpen] = useState(false); const [editingNumber, setEditingNumber] = useState<string | null>(null); const [deleteNumber, setDeleteNumber] = useState<string | null>(null); const [printChallan, setPrintChallan] = useState<Challan | null>(null)
  const idKind = type === 'PURCHASE' ? 'purchaseChallan' : 'saleChallan'
  useEffect(() => { void window.office.ids.next(idKind).then(setNumber).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not reserve challan number')) }, [idKind])
  const accountChoices = useMemo(() => {
    const partyRoot = accounts.find((account) => account.description.trim().toLowerCase() === 'party')
    if (!partyRoot) return accounts.filter((account) => account.description.trim().toLowerCase() === 'cash in hand')
    const descendants = new Set([partyRoot.code]); let changed = true
    while (changed) { changed = false; for (const account of accounts) if (account.parentCode && descendants.has(account.parentCode) && !descendants.has(account.code)) { descendants.add(account.code); changed = true } }
    return accounts.filter((account) => account.code !== partyRoot.code && descendants.has(account.code) || account.description.trim().toLowerCase() === 'cash in hand')
  }, [accounts])
  const setLine = (index: number, field: 'itemCode' | 'quantity', value: string) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: field === 'quantity' ? Number(value) : value } : line))
  const total = lines.reduce((sum, line) => { const item = items.find((row) => row.code === line.itemCode); return sum + Number(line.quantity || 0) * (type === 'PURCHASE' ? item?.purchaseRate ?? 0 : item?.saleRate ?? 0) }, 0)
  function beginEdit(row: Challan) { setEditingNumber(row.number); setNumber(row.number); setDate(row.date); setParty(row.party); setLocation(row.location); setLines(row.lines.map((line) => ({ itemCode: line.itemCode, quantity: line.quantity }))); setEditorOpen(true) }
  async function submit() {
    setPosting(true)
    try { const value = { number, type, date, party, location, lines }; if (editingNumber) { await onUpdate(value); toast.success('Challan updated') } else { await onPost(value); toast.success(`${type === 'PURCHASE' ? 'Purchase' : 'Sale'} challan posted`) }; setEditingNumber(null); setNumber(await window.office.ids.next(idKind)); setParty(''); setDate(today()); setLocation(locations[0] ?? 'Main'); setLines([{ itemCode: '', quantity: 1 }]); setEditorOpen(false) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not post challan') }
    finally { setPosting(false) }
  }
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{type === 'PURCHASE' ? 'Purchase Challans' : 'Sale Challans'}</h1><p className="mt-1 text-sm text-muted-foreground">Enter a document and its item lines. Rates are taken from the item master.</p></div><Button onClick={() => { setEditingNumber(null); setDate(today()); setEditorOpen(true) }}><Plus data-icon="inline-start" />New challan</Button></div>
    <Sheet open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setEditingNumber(null) }}><SheetContent side="right" className="flex data-[side=right]:w-[min(96vw,58rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>{editingNumber ? `Edit ${type.toLowerCase()} challan` : `New ${type.toLowerCase()} challan`}</SheetTitle><SheetDescription>Choose the party and location, then add one or more item lines. Editing recalculates rates from the current item master.</SheetDescription></SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Challan number" id="challan-number"><Input id="challan-number" value={number} disabled /></Field>
          <Field label="Date" id="challan-date"><DatePicker id="challan-date" value={date} onChange={setDate} /></Field>
          <Field label="Party account" id="challan-party"><FormSelect id="challan-party" value={party} onChange={setParty} placeholder="Select a party" options={accountChoices.map((account) => ({ value: account.code, label: `${account.code} — ${account.description}` }))} /></Field>
          <Field label="Location" id="challan-location"><Input id="challan-location" list="office-locations" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Warehouse / location" /><datalist id="office-locations">{locations.map((place) => <option key={place} value={place} />)}</datalist></Field>
        </FieldGroup>
        <section className="flex flex-col gap-3" aria-label="Challan item lines">
          <div><h3 className="text-sm font-semibold">Items</h3><p className="text-xs text-muted-foreground">Rates are filled from the selected item.</p></div>
          {lines.map((line, index) => {
            const item = items.find((row) => row.code === line.itemCode)
            const rate = type === 'PURCHASE' ? item?.purchaseRate ?? 0 : item?.saleRate ?? 0
            return <div key={index} className="rounded-xl border bg-card p-4">
              <div className="mb-4 flex items-center justify-between"><p className="text-sm font-medium">Line {String(index + 1).padStart(2, '0')}</p><Button variant="ghost" size="icon-sm" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 /></Button></div>
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(7rem,1fr)]">
                <Field label="Item code" id={`challan-item-${index}`}><FormSelect id={`challan-item-${index}`} value={line.itemCode} onChange={(value) => setLine(index, 'itemCode', value)} placeholder="Select an item" options={items.map((candidate) => ({ value: candidate.code, label: `${candidate.code} — ${candidate.description}` }))} /></Field>
                <Field label="Quantity" id={`challan-quantity-${index}`}><Input id={`challan-quantity-${index}`} type="number" min="0.01" step="any" value={line.quantity} onChange={(event) => setLine(index, 'quantity', event.target.value)} /></Field>
                <UiField><FieldLabel>Rate</FieldLabel><div className="flex h-9 items-center rounded-lg border bg-muted/40 px-3 font-medium tabular-nums">{money(rate)}</div></UiField>
                <UiField><FieldLabel>Amount</FieldLabel><div className="flex h-9 items-center rounded-lg border bg-muted/40 px-3 font-semibold tabular-nums">{money(rate * line.quantity)}</div></UiField>
              </FieldGroup>
            </div>
          })}
        </section>
      </div>
      <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-between gap-3 border-t px-6 py-4 sm:flex-row"><Button variant="outline" onClick={() => setLines((current) => [...current, { itemCode: '', quantity: 1 }])}><Plus data-icon="inline-start" />Add item</Button><div className="flex flex-wrap items-center justify-end gap-4"><span className="text-sm text-muted-foreground">Total <strong className="ml-2 text-base text-foreground tabular-nums">{money(total)}</strong></span><Button onClick={() => void submit()} disabled={posting || !items.length}>{posting ? 'Saving…' : editingNumber ? 'Save changes' : `Post ${type === 'PURCHASE' ? 'purchase' : 'sale'}`}</Button></div></SheetFooter>
    </SheetContent></Sheet>
    <Card><CardHeader><CardTitle className="text-base">Recorded documents</CardTitle><CardDescription>{rows.length} challan{rows.length === 1 ? '' : 's'}</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Location</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.number}><TableCell className="font-medium">{row.number}</TableCell><TableCell>{row.date}</TableCell><TableCell>{row.party}</TableCell><TableCell>{row.location}</TableCell><TableCell className="text-right tabular-nums">{money(row.total)}</TableCell><TableCell className="whitespace-nowrap"><Button variant="outline" size="sm" onClick={() => { setPrintChallan(row); window.setTimeout(requestPrint, 100) }}><PrinterIcon />Print</Button><Button variant="ghost" size="sm" onClick={() => beginEdit(row)}>Edit</Button><Button variant="ghost" size="sm" onClick={() => setDeleteNumber(row.number)}>Delete</Button></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No documents posted yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    {printChallan && <PrintDocument company={company} logo={logo} title={`${type === 'PURCHASE' ? 'Purchase' : 'Sale'} Challan`} subtitle={`Document ${printChallan.number} · ${printChallan.date} · Party ${printChallan.party} · Location ${printChallan.location}`} columns={['Item code', 'Description', 'Quantity', 'Rate', 'Amount']} rows={printChallan.lines.map((line) => { const item = items.find((candidate) => candidate.code === line.itemCode); return [line.itemCode, item?.description ?? '', String(line.quantity), money(line.rate), money(line.amount)] })} total={money(printChallan.total)} />}
    <AlertDialog open={deleteNumber !== null} onOpenChange={(open) => { if (!open) setDeleteNumber(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete challan {deleteNumber}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the document and its stock movements. A purchase deletion is blocked if it would leave negative stock.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const target = deleteNumber; if (target) void onDelete(target).then(() => toast.success('Challan deleted')).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not delete challan')).finally(() => setDeleteNumber(null)) }}>Delete challan</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}

function ChequePage({ rows, banks, accounts, onSave, onDelete }: { rows: Cheque[]; banks: Bank[]; accounts: Account[]; onSave: (value: Cheque) => Promise<void>; onDelete: (number: string) => Promise<void> }) {
  const [number, setNumber] = useState(''); const [bankCode, setBankCode] = useState(''); const [date, setDate] = useState(today()); const [party, setParty] = useState(''); const [amount, setAmount] = useState(''); const [status, setStatus] = useState('PENDING'); const [checkNumber, setCheckNumber] = useState(''); const [saving, setSaving] = useState(false); const [editorOpen, setEditorOpen] = useState(false); const [editing, setEditing] = useState(false); const [deleteNumber, setDeleteNumber] = useState<string | null>(null)
  const partyRoot = accounts.find((account) => account.description.trim().toLowerCase() === 'party')
  useEffect(() => { void window.office.ids.next('cheque').then(setNumber).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not reserve cheque ID')) }, [])
  const partyCodes = new Set<string>()
  if (partyRoot) { partyCodes.add(partyRoot.code); let changed = true; while (changed) { changed = false; for (const account of accounts) if (account.parentCode && partyCodes.has(account.parentCode) && !partyCodes.has(account.code)) { partyCodes.add(account.code); changed = true } } }
  const partyChoices = accounts.filter((account) => (partyRoot ? account.code !== partyRoot.code && partyCodes.has(account.code) : false) || account.description.trim().toLowerCase() === 'cash in hand')
  function beginEdit(row: Cheque) { setNumber(row.number); setBankCode(row.bankCode); setDate(row.date); setParty(row.party); setAmount(String(row.amount)); setStatus(row.status); setCheckNumber(row.checkNumber); setEditing(true); setEditorOpen(true) }
  async function submit() {
    setSaving(true)
    try { await onSave({ number, bankCode, date, party, amount: Number(amount), status, checkNumber }); toast.success(editing ? 'Cheque updated' : 'Cheque saved'); setEditing(false); setNumber(await window.office.ids.next('cheque')); setParty(''); setAmount(''); setCheckNumber(''); setDate(today()); setStatus('PENDING'); setEditorOpen(false) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save cheque') }
    finally { setSaving(false) }
  }
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Cheque Detail</h1><p className="mt-1 text-sm text-muted-foreground">Record cheque information, bank, party, and status.</p></div><Button onClick={() => { setEditing(false); setDate(today()); setEditorOpen(true) }}><Plus data-icon="inline-start" />New cheque</Button></div>
    <Sheet open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setEditing(false) }}><SheetContent side="right" className="flex data-[side=right]:w-[min(92vw,38rem)] flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>{editing ? 'Edit cheque' : 'New cheque record'}</SheetTitle><SheetDescription>Record the check number, bank, party, amount, and current status.</SheetDescription></SheetHeader>
      <FieldGroup className="grid min-h-0 flex-1 content-start grid-cols-1 gap-x-5 gap-y-5 overflow-y-auto p-6 sm:grid-cols-2">
        <Field label="Cheque ID" id="cheque-id"><Input id="cheque-id" value={number} disabled /></Field>
        <Field label="Check Number" id="check-number"><Input id="check-number" value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)} /></Field>
        <Field label="Bank" id="cheque-bank"><FormSelect id="cheque-bank" value={bankCode} onChange={setBankCode} placeholder="Select a bank" options={banks.map((bank) => ({ value: bank.code, label: `${bank.code} — ${bank.name}` }))} /></Field>
        <Field label="Cheque date" id="cheque-date"><DatePicker id="cheque-date" value={date} onChange={setDate} /></Field>
        <Field label="Party" id="cheque-party"><FormSelect id="cheque-party" value={party} onChange={setParty} placeholder="Select a party" options={partyChoices.map((account) => ({ value: account.code, label: `${account.code} — ${account.description}` }))} /></Field>
        <Field label="Amount" id="cheque-amount"><Input id="cheque-amount" type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
        <Field label="Status" id="cheque-status"><FormSelect id="cheque-status" value={status} onChange={setStatus} placeholder="Select status" options={['PENDING', 'CLEARED', 'RETURNED', 'CANCELLED'].map((entry) => ({ value: entry, label: entry }))} /></Field>
      </FieldGroup>
      <SheetFooter className="mt-0 border-t px-6 py-4"><Button onClick={() => void submit()} disabled={saving || !banks.length}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save cheque'}</Button></SheetFooter>
    </SheetContent></Sheet>
    <Card><CardHeader><CardTitle className="text-base">Saved cheques</CardTitle><CardDescription>{rows.length} record{rows.length === 1 ? '' : 's'}</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Cheque ID</TableHead><TableHead>Check Number</TableHead><TableHead>Date</TableHead><TableHead>Bank</TableHead><TableHead>Party</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.number}><TableCell className="font-medium">{row.number}</TableCell><TableCell>{row.checkNumber || '—'}</TableCell><TableCell>{row.date}</TableCell><TableCell>{banks.find((bank) => bank.code === row.bankCode)?.name ?? row.bankCode}</TableCell><TableCell>{row.party}</TableCell><TableCell><Badge variant="secondary">{row.status}</Badge></TableCell><TableCell className="text-right tabular-nums">{money(row.amount)}</TableCell><TableCell className="whitespace-nowrap"><Button variant="ghost" size="sm" onClick={() => beginEdit(row)}>Edit</Button><Button variant="ghost" size="sm" onClick={() => setDeleteNumber(row.number)}>Delete</Button></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={8} className="h-20 text-center text-muted-foreground">No cheques recorded yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <AlertDialog open={deleteNumber !== null} onOpenChange={(open) => { if (!open) setDeleteNumber(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete cheque {deleteNumber}?</AlertDialogTitle><AlertDialogDescription>This permanently deletes the cheque and its status history. The deletion remains in the audit log.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const target = deleteNumber; if (target) void onDelete(target).then(() => toast.success('Cheque deleted')).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not delete cheque')).finally(() => setDeleteNumber(null)) }}>Delete cheque</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <UiField><FieldLabel htmlFor={id}>{label}</FieldLabel>{children}</UiField> }
