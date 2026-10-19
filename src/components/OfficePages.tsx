import { useEffect, useMemo, useState } from 'react'
import { Download, Pencil, Plus, Printer, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field as UiField, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DatePicker } from '@/components/DatePicker'
import type { Account, Challan, Cheque, CompanyProfile, Item, StockMovement, Voucher } from '@/types'
import { PrintDocument, PrintPreviewDialog, requestPrint } from '@/components/PrintDocument'
import { REPORT_NAMES } from '@/lib/report-names'

type EntryLine = { accountCode: string; debit: string; credit: string }
type EntryType = 'VOUCHER' | 'JOURNAL VOUCHER' | 'PAYMENT'
const today = () => new Date().toISOString().slice(0, 10)
const money = (value: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

export function VoucherEntryPage({ type, accounts, vouchers, company, logo, onSave, onDelete }: { type: EntryType; accounts: Account[]; vouchers: Voucher[]; company: CompanyProfile | null; logo: string | null; onSave: (value: Voucher & { update?: boolean }) => Promise<void>; onDelete: (number: string) => Promise<void> }) {
  const [number, setNumber] = useState('')
  const [date, setDate] = useState(today())
  const [narration, setNarration] = useState('')
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<EntryLine[]>([{ accountCode: '', debit: '', credit: '' }, { accountCode: '', debit: '', credit: '' }])
  const [paymentType, setPaymentType] = useState<'PAYMENT' | 'RECEIPT'>('PAYMENT')
  const [cashAccount, setCashAccount] = useState('')
  const [partyAccount, setPartyAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [editing, setEditing] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null)
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  const visible = vouchers.filter((voucher) => type === 'PAYMENT' ? ['PAYMENT', 'RECEIPT'].includes(voucher.type) : voucher.type === type)
  const clear = async () => {
    setEditing(false); setNumber(''); setDate(today()); setNarration(''); setReference('')
    setLines([{ accountCode: '', debit: '', credit: '' }, { accountCode: '', debit: '', credit: '' }])
    setPaymentType('PAYMENT'); setCashAccount(''); setPartyAccount(''); setAmount('')
    try { setNumber(await window.office.ids.next('voucher')) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not generate voucher number') }
  }
  useEffect(() => { void clear() }, [type])
  const edit = (voucher: Voucher) => {
    setEditorOpen(true)
    setEditing(true); setNumber(voucher.number); setDate(voucher.date); setNarration(voucher.narration); setReference(voucher.reference)
    setLines(voucher.lines.map((line) => ({ accountCode: line.accountCode, debit: String(line.debit), credit: String(line.credit) })))
    if (voucher.type === 'PAYMENT' || voucher.type === 'RECEIPT') {
      setPaymentType(voucher.type)
      const cash = voucher.lines.find((line) => voucher.type === 'PAYMENT' ? line.credit > 0 : line.debit > 0)
      const other = voucher.lines.find((line) => line.accountCode !== cash?.accountCode)
      setCashAccount(cash?.accountCode ?? ''); setPartyAccount(other?.accountCode ?? '')
      setAmount(String(Math.max(...voucher.lines.map((line) => line.debit + line.credit))))
    }
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      let voucherLines = lines.map((line) => ({ accountCode: line.accountCode, debit: Number(line.debit || 0), credit: Number(line.credit || 0) }))
      const savedType: Voucher['type'] = type === 'PAYMENT' ? paymentType : type
      if (type === 'PAYMENT') {
        const value = Number(amount)
        if (!partyAccount || !cashAccount || partyAccount === cashAccount) throw new Error('Choose two different party and cash/bank accounts')
        voucherLines = paymentType === 'PAYMENT'
          ? [{ accountCode: partyAccount, debit: value, credit: 0 }, { accountCode: cashAccount, debit: 0, credit: value }]
          : [{ accountCode: cashAccount, debit: value, credit: 0 }, { accountCode: partyAccount, debit: 0, credit: value }]
      }
      await onSave({ number, date, narration, reference, type: savedType, lines: voucherLines, update: editing })
      await clear()
      setEditorOpen(false)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save voucher') }
    finally { setSaving(false) }
  }
  const debitTotal = lines.reduce((total, line) => total + Number(line.debit || 0), 0)
  const creditTotal = lines.reduce((total, line) => total + Number(line.credit || 0), 0)
  return <section className="flex flex-col gap-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{type === 'PAYMENT' ? 'Payment / Receipt' : type === 'VOUCHER' ? 'Voucher' : 'Journal Voucher'}</h1><p className="mt-1 text-sm text-muted-foreground">Post balanced double-entry transactions. Saved records are audited and can be edited or deleted.</p></div><Button onClick={() => { void clear().then(() => setEditorOpen(true)) }}><Plus data-icon="inline-start" />New {type === 'PAYMENT' ? 'entry' : 'voucher'}</Button></div>
    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent side="right" className="flex data-[side=right]:w-[min(96vw,54rem)] flex-col gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-none"><SheetHeader className="border-b px-6 py-5"><SheetTitle>{editing ? `Edit ${number}` : `New ${type === 'PAYMENT' ? paymentType.toLowerCase() : type.toLowerCase()}`}</SheetTitle><SheetDescription>Every posting must have equal debit and credit totals. Posting does not automatically account for purchase or sale challans.</SheetDescription></SheetHeader><Card className="m-4 border-0 shadow-none"><CardContent className="pt-5"><form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><Field label="Voucher number" id="voucher-number"><Input id="voucher-number" value={number} disabled /></Field><Field label="Date" id="voucher-date"><DatePicker id="voucher-date" value={date} onChange={setDate} /></Field>{type === 'PAYMENT' && <Field label="Entry type" id="payment-type"><FormSelect id="payment-type" value={paymentType} onChange={(value) => setPaymentType(value as 'PAYMENT' | 'RECEIPT')} options={[{ value: 'PAYMENT', label: 'Payment' }, { value: 'RECEIPT', label: 'Receipt' }]} placeholder="Choose type" disabled={editing} /></Field>}<Field label="Reference" id="voucher-reference"><Input id="voucher-reference" value={reference} onChange={(event) => setReference(event.target.value)} /></Field><Field label="Narration" id="voucher-narration"><Input id="voucher-narration" value={narration} onChange={(event) => setNarration(event.target.value)} /></Field></FieldGroup>
      {type === 'PAYMENT' ? <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label="Cash / Bank account" id="payment-cash"><FormSelect id="payment-cash" value={cashAccount} onChange={setCashAccount} options={accounts.map((account) => ({ value: account.code, label: `${account.code} — ${account.description}` }))} placeholder="Select account" /></Field><Field label="Party account" id="payment-party"><FormSelect id="payment-party" value={partyAccount} onChange={setPartyAccount} options={accounts.map((account) => ({ value: account.code, label: `${account.code} — ${account.description}` }))} placeholder="Select account" /></Field><Field label="Amount" id="payment-amount"><Input id="payment-amount" type="number" min="0.01" step="any" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field></FieldGroup> : <div className="flex flex-col gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Voucher lines</h3><Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, { accountCode: '', debit: '', credit: '' }])}><Plus data-icon="inline-start" />Add line</Button></div><div className="overflow-x-auto rounded-md border"><Table managed={false}><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Debit</TableHead><TableHead>Credit</TableHead><TableHead /></TableRow></TableHeader><TableBody>{lines.map((line, index) => <TableRow key={index}><TableCell className="min-w-56"><FormSelect value={line.accountCode} onChange={(accountCode) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, accountCode } : entry))} options={accounts.map((account) => ({ value: account.code, label: `${account.code} — ${account.description}` }))} placeholder="Select account" /></TableCell><TableCell><Input aria-label={`Debit line ${index + 1}`} className="min-w-28" type="number" min="0" step="any" value={line.debit} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, debit: event.target.value, credit: event.target.value ? '' : entry.credit } : entry))} /></TableCell><TableCell><Input aria-label={`Credit line ${index + 1}`} className="min-w-28" type="number" min="0" step="any" value={line.credit} onChange={(event) => setLines((current) => current.map((entry, row) => row === index ? { ...entry, credit: event.target.value, debit: event.target.value ? '' : entry.debit } : entry))} /></TableCell><TableCell><Button type="button" size="icon-sm" variant="ghost" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((_, row) => row !== index))}><Trash2 /></Button></TableCell></TableRow>)}</TableBody></Table></div><div className="flex justify-end gap-6 text-sm"><span>Debit <strong>{money(debitTotal)}</strong></span><span>Credit <strong>{money(creditTotal)}</strong></span><Badge variant={Math.abs(debitTotal - creditTotal) < 1e-8 && debitTotal > 0 ? 'secondary' : 'outline'}>{Math.abs(debitTotal - creditTotal) < 1e-8 && debitTotal > 0 ? 'Balanced' : 'Unbalanced'}</Badge></div></div>}
      <SheetFooter className="flex-row justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => void clear()}>Clear form</Button><Button type="submit" disabled={saving || accounts.length < 2}>{saving ? 'Saving…' : editing ? 'Update voucher' : 'Post voucher'}</Button></SheetFooter>
    </form></CardContent></Card></SheetContent></Sheet>
    <Card><CardHeader><CardTitle className="text-base">Saved entries</CardTitle><CardDescription>{visible.length} {visible.length === 1 ? 'entry' : 'entries'}</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Number</TableHead><TableHead>Type</TableHead><TableHead>Narration</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="w-32 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visible.map((voucher) => { const total = voucher.lines.reduce((sum, line) => sum + line.debit, 0); return <TableRow key={voucher.number}><TableCell>{voucher.date}</TableCell><TableCell className="font-medium">{voucher.number}</TableCell><TableCell>{voucher.type}</TableCell><TableCell>{voucher.narration || '—'}</TableCell><TableCell className="text-right tabular-nums">{money(total)}</TableCell><TableCell className="text-right tabular-nums">{money(total)}</TableCell><TableCell className="min-w-32"><div className="flex items-center justify-end gap-1"><Button size="icon-sm" variant="ghost" title="Print voucher" aria-label="Print voucher" onClick={() => { setPrintVoucher(voucher); setPrintPreviewOpen(true) }}><Printer /></Button><Button size="icon-sm" variant="ghost" title="Edit voucher" aria-label="Edit voucher" onClick={() => edit(voucher)}><Pencil /></Button><Button size="icon-sm" variant="ghost" title="Delete voucher" aria-label="Delete voucher" onClick={() => { if (window.confirm(`Delete voucher ${voucher.number}?`)) void onDelete(voucher.number).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not delete voucher')) }}><Trash2 /></Button></div></TableCell></TableRow> })}{!visible.length && <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No entries have been posted.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    {printVoucher && <>
      <PrintDocument company={company} logo={logo} title={printVoucher.type} subtitle={`Voucher ${printVoucher.number} · ${printVoucher.date}${printVoucher.reference ? ` · Reference ${printVoucher.reference}` : ''}${printVoucher.narration ? ` · ${printVoucher.narration}` : ''}`} columns={['Account', 'Debit', 'Credit']} rows={printVoucher.lines.map((line) => [`${line.accountCode} — ${accounts.find((account) => account.code === line.accountCode)?.description ?? ''}`, money(line.debit), money(line.credit)])} total={money(printVoucher.lines.reduce((sum, line) => sum + line.debit, 0))} />
      <PrintPreviewDialog open={printPreviewOpen} onOpenChange={setPrintPreviewOpen} onPrint={requestPrint} company={company} logo={logo} title={printVoucher.type} subtitle={`Voucher ${printVoucher.number} · ${printVoucher.date}${printVoucher.reference ? ` · Reference ${printVoucher.reference}` : ''}${printVoucher.narration ? ` · ${printVoucher.narration}` : ''}`} columns={['Account', 'Debit', 'Credit']} rows={printVoucher.lines.map((line) => [`${line.accountCode} — ${accounts.find((account) => account.code === line.accountCode)?.description ?? ''}`, money(line.debit), money(line.credit)])} total={money(printVoucher.lines.reduce((sum, line) => sum + line.debit, 0))} />
    </>}
  </section>
}

export function PaymentSearchPage({ vouchers, accounts }: { vouchers: Voucher[]; accounts: Account[] }) {
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [account, setAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [entryType, setEntryType] = useState<'*' | 'PAYMENT' | 'RECEIPT'>('*')
  const rows = vouchers.filter((voucher) => (entryType === '*' || voucher.type === entryType) && (!from || voucher.date >= from) && (!to || voucher.date <= to) && (!account || voucher.lines.some((line) => line.accountCode === account)) && (!amount || voucher.lines.some((line) => line.debit === Number(amount) || line.credit === Number(amount))) && `${voucher.number} ${voucher.narration} ${voucher.reference} ${voucher.lines.map((line) => line.accountCode).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const activeFilters = [query, from, to, account, amount, entryType !== '*' ? entryType : ''].filter(Boolean).length
  const clearFilters = () => { setQuery(''); setFrom(''); setTo(''); setAccount(''); setAmount(''); setEntryType('*') }
  return <section className="flex flex-col gap-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">Search Payment</h1><p className="mt-1 text-sm text-muted-foreground">Narrow payments and receipts using text, date range, account, type, or amount.</p></div>
    <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><CardTitle className="text-base">Filters</CardTitle><CardDescription>All populated filters must match.</CardDescription></div><Button type="button" variant="outline" size="sm" disabled={!activeFilters} onClick={clearFilters}><X data-icon="inline-start" />Clear{activeFilters ? ` · ${activeFilters}` : ''}</Button></div></CardHeader><CardContent className="pt-0"><FieldGroup className="flex flex-col gap-4">
        <Field label="Search text" id="payment-search"><Input id="payment-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Number, reference, narration…" /></Field>
        <Field label="Entry type" id="payment-type-filter"><FormSelect id="payment-type-filter" value={entryType} onChange={(value) => setEntryType(value as typeof entryType)} options={[{ value: '*', label: 'Payments and receipts' }, { value: 'PAYMENT', label: 'Payment only' }, { value: 'RECEIPT', label: 'Receipt only' }]} placeholder="Any type" /></Field>
        <Field label="Exact amount" id="payment-amount-filter"><Input id="payment-amount-filter" type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Any amount" /></Field>
        <Field label="From date" id="payment-from"><DatePicker id="payment-from" value={from} onChange={setFrom} placeholder="Start date" /></Field>
        <Field label="To date" id="payment-to"><DatePicker id="payment-to" value={to} onChange={setTo} placeholder="End date" /></Field>
        <Field label="Account" id="payment-account"><FormSelect id="payment-account" value={account || '*'} onChange={(value) => setAccount(value === '*' ? '' : value)} options={[{ value: '*', label: 'Any account' }, ...accounts.map((row) => ({ value: row.code, label: `${row.code} — ${row.description}` }))]} placeholder="Any account" /></Field>
      </FieldGroup></CardContent></Card>
      <Card className="min-w-0"><CardHeader><CardTitle className="text-base">Matching entries</CardTitle><CardDescription>{rows.length} result{rows.length === 1 ? '' : 's'}</CardDescription></CardHeader><CardContent><Table filterable={false}><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Number</TableHead><TableHead>Type</TableHead><TableHead>Accounts</TableHead><TableHead>Reference</TableHead><TableHead>Narration</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.number}><TableCell>{row.date}</TableCell><TableCell>{row.number}</TableCell><TableCell>{row.type}</TableCell><TableCell>{row.lines.map((line) => accounts.find((entry) => entry.code === line.accountCode)?.description ?? line.accountCode).join(' · ')}</TableCell><TableCell>{row.reference || '—'}</TableCell><TableCell>{row.narration || '—'}</TableCell><TableCell className="text-right tabular-nums">{money(row.lines.reduce((sum, line) => sum + line.debit, 0))}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No matching payments or receipts.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    </div>
  </section>
}

type ReportRow = Record<string, string | number>
export function ReportsPage({ reportName, onReportChange, challans, items, accounts, movements, cheques, vouchers, company, logo }: { reportName: string; onReportChange: (name: string) => void; challans: Challan[]; items: Item[]; accounts: Account[]; movements: StockMovement[]; cheques: Cheque[]; vouchers: Voucher[]; company: CompanyProfile | null; logo: string | null }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filter, setFilter] = useState('')
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  const rows = useMemo(() => buildReport(reportName, { challans, items, accounts, movements, cheques, vouchers }, from, to, filter), [reportName, challans, items, accounts, movements, cheques, vouchers, from, to, filter])
  const columns = rows.length ? Object.keys(rows[0]) : ['Result']
  const printRows = rows.map((row) => columns.map((column) => String(row[column] ?? '')))
  const printSubtitle = [from && `From ${from}`, to && `through ${to}`, filter && `Filter: ${filter}`].filter(Boolean).join(' · ')
  const unsupported = ['Receivables', 'Payables', 'Aging Report', 'Receivable'].includes(reportName)
  const caution = unsupported
    ? 'Reliable balances need due dates and payment-to-invoice allocations, which this database does not store.'
    : ['Balance Sheet', 'Profit & Loss'].includes(reportName)
      ? 'Accounts are not classified into financial statement categories, and challans do not create accounting postings. Treat these rows as unclassified voucher balances, not formal statements.'
      : ['Company Profitability Report', 'Item Profitability Report', 'PC Profit Report'].includes(reportName)
        ? 'This is a simple sales-minus-purchase comparison, not cost-of-goods-sold accounting or validated gross profit.'
        : 'Calculated from records currently stored in this application only. It does not include external legacy transactions.'
  const exportCsv = () => {
    const csv = [columns, ...rows.map((row) => columns.map((column) => String(row[column] ?? '')))].map((cells) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${reportName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.csv`; link.click(); URL.revokeObjectURL(link.href)
  }
  return <section className="flex flex-col gap-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">{reportName}</h1><p className="mt-1 text-sm text-muted-foreground">Reports from the Java menu are available from the Reports menu or selector.</p></div>
    <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card><CardHeader><CardTitle className="text-base">Report filters</CardTitle><CardDescription>Choose a report and narrow its results.</CardDescription></CardHeader><CardContent><FieldGroup className="flex flex-col gap-4"><Field label="Report" id="report-name"><FormSelect id="report-name" value={reportName} onChange={onReportChange} options={REPORT_NAMES.map((name) => ({ value: name, label: name }))} placeholder="Select report" /></Field><Field label="From date" id="report-from"><DatePicker id="report-from" value={from} onChange={setFrom} placeholder="Start date" /></Field><Field label="To date" id="report-to"><DatePicker id="report-to" value={to} onChange={setTo} placeholder="End date" /></Field><Field label="Text filter" id="report-filter"><Input id="report-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Item, account, party, document…" /></Field></FieldGroup><div className="mt-4 flex flex-col gap-2"><Button variant="outline" onClick={exportCsv}><Download data-icon="inline-start" />Export CSV</Button><Button variant="outline" onClick={() => setPrintPreviewOpen(true)}><Printer data-icon="inline-start" />Print report</Button></div></CardContent></Card>
      <Card className="min-w-0"><CardHeader><CardTitle className="text-base">{rows.length} result{rows.length === 1 ? '' : 's'}</CardTitle><CardDescription>{caution}</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table filterable={false}><TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}>{columns.map((column) => <TableCell key={column} className={typeof row[column] === 'number' ? 'tabular-nums' : ''}>{typeof row[column] === 'number' ? money(row[column] as number) : row[column]}</TableCell>)}</TableRow>)}{!rows.length && <TableRow><TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">{unsupported ? 'No validated calculation is possible with the fields currently captured.' : 'No records match this report and filter.'}</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    </div>
    <PrintDocument company={company} logo={logo} title={reportName} subtitle={printSubtitle} columns={columns} rows={printRows} />
    <PrintPreviewDialog open={printPreviewOpen} onOpenChange={setPrintPreviewOpen} onPrint={requestPrint} company={company} logo={logo} title={reportName} subtitle={printSubtitle} columns={columns} rows={printRows} />
  </section>
}

function buildReport(name: string, data: { challans: Challan[]; items: Item[]; accounts: Account[]; movements: StockMovement[]; cheques: Cheque[]; vouchers: Voucher[] }, from: string, to: string, filter: string): ReportRow[] {
  const { challans, items, accounts, movements, cheques, vouchers } = data
  const dated = (date: string) => (!from || date >= from) && (!to || date <= to)
  const has = (value: unknown) => String(value ?? '').toLowerCase().includes(filter.toLowerCase())
  const docs = challans.filter((row) => dated(row.date) && has(`${row.number} ${row.party} ${row.location} ${row.lines.map((line) => line.itemCode).join(' ')}`))
  const allMoves = movements.filter((row) => has(`${row.document} ${row.itemCode} ${row.location} ${row.type}`))
  const moves = allMoves.filter((row) => dated(row.date))
  const voucherLines = vouchers.filter((row) => dated(row.date)).flatMap((voucher) => voucher.lines.map((line) => ({ date: voucher.date, voucher: voucher.number, reference: voucher.reference, narration: voucher.narration, type: voucher.type, ...line }))).filter((line) => has(`${line.voucher} ${line.type} ${line.narration} ${line.reference} ${line.accountCode} ${accounts.find((account) => account.code === line.accountCode)?.description}`))
  if (['Transit', 'Stock Ledger', 'Item Ledger', 'Stock Report Date Wise', 'Stock Report Item Wise'].includes(name)) {
    const sorted = [...allMoves].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    const balance = new Map<string, number>()
    return sorted.reduce<ReportRow[]>((rows, movement) => {
      const key = `${movement.itemCode}\u0000${movement.location}`
      const current = (balance.get(key) ?? 0) + movement.quantity; balance.set(key, current)
      if (!dated(movement.date)) return rows
      if (name === 'Transit') rows.push({ Date: movement.date, Document: movement.document, Item: movement.itemCode, Location: movement.location, Quantity: movement.quantity, Movement: movement.type })
      else if (name === 'Stock Report Item Wise') rows.push({ Item: movement.itemCode, Date: movement.date, Location: movement.location, 'Quantity In': Math.max(0, movement.quantity), 'Quantity Out': Math.max(0, -movement.quantity), Balance: current })
      else if (name === 'Stock Report Date Wise') rows.push({ Date: movement.date, Item: movement.itemCode, Location: movement.location, 'Quantity In': Math.max(0, movement.quantity), 'Quantity Out': Math.max(0, -movement.quantity), Balance: current })
      else rows.push({ Date: movement.date, Document: movement.document, Item: movement.itemCode, Location: movement.location, 'Quantity In': Math.max(0, movement.quantity), 'Quantity Out': Math.max(0, -movement.quantity), Balance: current })
      return rows
    }, [])
  }
  if (name === 'Stock Summary') {
    const totals = new Map<string, { Item: string; Location: string; 'Net quantity': number; 'Recorded value': number }>()
    moves.forEach((row) => { const key = `${row.itemCode}|${row.location}`; const total = totals.get(key) ?? { Item: row.itemCode, Location: row.location, 'Net quantity': 0, 'Recorded value': 0 }; total['Net quantity'] += row.quantity; total['Recorded value'] += row.amount; totals.set(key, total) })
    return [...totals.values()].filter((row) => row['Net quantity'] !== 0)
  }
  if (['Purchase Register', 'Sales Register', 'Purchase Report Date Wise'].includes(name)) {
    const expected = name === 'Sales Register' ? 'SALE' : 'PURCHASE'
    return docs.filter((row) => row.type === expected).flatMap<ReportRow>((row): ReportRow[] => name === 'Purchase Report Date Wise' ? row.lines.map((line): ReportRow => ({ Date: row.date, Document: row.number, Party: row.party, Item: line.itemCode, Quantity: line.quantity, Amount: line.amount })) : [{ Date: row.date, Document: row.number, Party: row.party, Location: row.location, Lines: row.lines.length, Total: row.total }])
  }
  if (['Post Dated Cheques', 'Returned Cheques', 'OS Cheques'].includes(name)) {
    const now = today()
    return cheques.filter((row) => dated(row.date) && (name === 'Returned Cheques' ? row.status === 'RETURNED' : name === 'Post Dated Cheques' ? row.status === 'PENDING' && row.date > now : row.status === 'PENDING' && row.date <= now) && has(`${row.number} ${row.party} ${row.bankCode} ${row.status}`)).map((row) => ({ Number: row.number, Date: row.date, Party: row.party, Bank: row.bankCode, Amount: row.amount, Status: row.status, ...(name === 'OS Cheques' ? { 'Days outstanding': Math.max(0, Math.floor((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${row.date}T00:00:00Z`)) / 86400000)) } : {}) }))
  }
  if (['Company Profitability Report', 'Item Profitability Report', 'PC Profit Report'].includes(name)) {
    const totals = new Map<string, { Purchase: number; Sale: number }>()
    docs.forEach((document) => document.lines.forEach((line) => { const key = name === 'Item Profitability Report' ? line.itemCode : name === 'PC Profit Report' ? `${document.date} · ${document.party}` : document.date; const row = totals.get(key) ?? { Purchase: 0, Sale: 0 }; row[document.type === 'PURCHASE' ? 'Purchase' : 'Sale'] += line.amount; totals.set(key, row) }))
    return [...totals].map(([group, total]) => ({ [name === 'Item Profitability Report' ? 'Item' : name === 'PC Profit Report' ? 'Date · Party' : 'Date']: group, ...total, 'Sales less purchases': total.Sale - total.Purchase }))
  }
  if (name === 'Cash Book' || name === 'Bank Book') {
    const marker = name === 'Cash Book' ? 'cash' : 'bank'
    return voucherLines.filter((line) => (accounts.find((account) => account.code === line.accountCode)?.description ?? '').toLowerCase().includes(marker)).map((line) => ({ Date: line.date, Voucher: line.voucher, Account: line.accountCode, Particulars: line.narration || line.reference || line.type, Receipt: line.debit, Payment: line.credit, Balance: line.debit - line.credit }))
  }
  if (['Trial Balance', 'Trial Balance Date Wise', 'General Ledger', 'Ledger', 'Cash Book', 'Bank Book', 'Balance Sheet', 'Profit & Loss'].includes(name)) {
    const accountTotals = new Map(accounts.map((account) => [account.code, { debit: account.openingBalance > 0 ? account.openingBalance : 0, credit: account.openingBalance < 0 ? -account.openingBalance : 0 }]))
    voucherLines.forEach((line) => { const total = accountTotals.get(line.accountCode) ?? { debit: 0, credit: 0 }; total.debit += line.debit; total.credit += line.credit; accountTotals.set(line.accountCode, total) })
    if (name === 'General Ledger' || name === 'Ledger') return voucherLines.filter((line) => has(`${line.accountCode} ${accounts.find((account) => account.code === line.accountCode)?.description}`)).map((line) => ({ Date: line.date, Voucher: line.voucher, Account: line.accountCode, Description: line.narration || line.reference || line.type, Debit: line.debit, Credit: line.credit, Balance: line.debit - line.credit }))
    if (name === 'Trial Balance Date Wise') return voucherLines.map((line) => ({ Date: line.date, Account: line.accountCode, Debit: line.debit, Credit: line.credit, Balance: line.debit - line.credit }))
    return [...accountTotals].filter(([code]) => has(`${code} ${accounts.find((account) => account.code === code)?.description}`)).map(([code, total]) => ({ Account: code, Description: accounts.find((account) => account.code === code)?.description ?? '', Debit: total.debit, Credit: total.credit, Balance: total.debit - total.credit }))
  }
  if (name === 'Party Activity Report' || name === 'Party Ledger' || name === 'Party Item Detail') {
    if (name === 'Party Item Detail') return docs.flatMap((document) => document.lines.map((line) => ({ Party: document.party, Item: line.itemCode, Date: document.date, Document: document.number, Quantity: line.quantity, Rate: line.rate, Amount: line.amount })))
    return docs.map((document) => ({ Date: document.date, Party: document.party, Activity: document.type, Reference: document.number, ...(name === 'Party Ledger' ? { Debit: document.type === 'SALE' ? document.total : 0, Credit: document.type === 'PURCHASE' ? document.total : 0, Balance: document.type === 'SALE' ? document.total : -document.total } : { Amount: document.total }) }))
  }
  if (name === 'Type Wise Item Report') return items.filter((item) => has(`${item.code} ${item.description} ${item.stockType}`)).map((item) => ({ 'Stock type': item.stockType, Item: item.code, Description: item.description, 'Current quantity': movements.filter((movement) => movement.itemCode === item.code).reduce((sum, movement) => sum + movement.quantity, 0), 'Purchase rate': item.purchaseRate }))
  if (['Receivables', 'Payables', 'Aging Report', 'Receivable'].includes(name)) return []
  if (name === 'Voucher') return voucherLines.map((line) => ({ Date: line.date, Number: line.voucher, Type: line.type, Account: line.accountCode, Debit: line.debit, Credit: line.credit, Narration: line.narration }))
  return []
}

function FormSelect({ id, value, onChange, options, placeholder, disabled = false }: { id?: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder: string; disabled?: boolean }) {
  return <Select value={value || null} onValueChange={(next) => onChange(next ?? '')} disabled={disabled}><SelectTrigger id={id} className="h-9 w-full"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
}
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <UiField><FieldLabel htmlFor={id}>{label}</FieldLabel>{children}</UiField> }
