import { useState } from 'react'
import { Archive, CheckCircle2, Download, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { DatabaseVerification } from '@/types'

const readableSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function DatabaseToolsPage() {
  const [working, setWorking] = useState<'backup' | 'export' | 'verify' | null>(null)
  const [verification, setVerification] = useState<DatabaseVerification | null>(null)

  async function run<T>(action: 'backup' | 'export' | 'verify', task: () => Promise<T>, done: (result: T) => void) {
    setWorking(action)
    try { done(await task()) }
    catch (error) { toast.error(error instanceof Error ? error.message : `Could not ${action} database`) }
    finally { setWorking(null) }
  }

  return <section className="flex flex-col gap-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">Database Tools</h1><p className="mt-1 text-sm text-muted-foreground">Protect and inspect this computer’s local office database.</p></div>
    <div className="grid gap-5 xl:grid-cols-3">
      <Card><CardHeader><Archive className="mb-1 size-5 text-primary" /><CardTitle className="text-base">Create a backup</CardTitle><CardDescription>Writes a consistent SQLite snapshot while the app is open.</CardDescription></CardHeader><CardContent className="grid gap-3"><p className="text-sm text-muted-foreground">Saved automatically in the app data folder’s <code className="rounded bg-muted px-1">backups</code> directory. Keep a copy on a separate drive for recovery.</p><div className="flex flex-wrap gap-2"><Button disabled={working !== null} onClick={() => void run('backup', () => window.office.database.backup(), (result) => toast.success(`Backup created · ${readableSize(result.bytes)} · ${result.path}`))}><Archive data-icon="inline-start" />{working === 'backup' ? 'Creating backup…' : 'Create backup now'}</Button><Button variant="outline" disabled={working !== null} onClick={() => void window.office.database.openBackups().catch((error) => toast.error(error instanceof Error ? error.message : 'Could not open backup folder'))}><FolderOpen data-icon="inline-start" />Open backup folder</Button></div></CardContent></Card>
      <Card><CardHeader><Download className="mb-1 size-5 text-primary" /><CardTitle className="text-base">Export office data</CardTitle><CardDescription>Save portable JSON records to a location you choose.</CardDescription></CardHeader><CardContent className="grid gap-3"><p className="text-sm text-muted-foreground">Includes company, accounts, inventory, transactions, and audit records. Password hashes and user credentials are excluded. This export is not a restorable database backup.</p><Button variant="outline" disabled={working !== null} onClick={() => void run('export', () => window.office.database.exportData(), (result) => { if (!result.canceled) toast.success(`Data export saved · ${result.path}`) })}><Download data-icon="inline-start" />{working === 'export' ? 'Exporting…' : 'Export data as JSON'}</Button></CardContent></Card>
      <Card><CardHeader><ShieldCheck className="mb-1 size-5 text-primary" /><CardTitle className="text-base">Verify database</CardTitle><CardDescription>Checks SQLite integrity and foreign-key references.</CardDescription></CardHeader><CardContent className="grid gap-3"><p className="text-sm text-muted-foreground">This is a diagnostic check, not a repair operation. Make a backup first if you suspect damage.</p><Button variant="outline" disabled={working !== null} onClick={() => void run('verify', () => window.office.database.verify(), (result) => { setVerification(result); toast[result.ok ? 'success' : 'error'](result.ok ? 'Database checks passed' : 'Database verification found issues') })}><RefreshCw data-icon="inline-start" className={working === 'verify' ? 'animate-spin' : ''} />{working === 'verify' ? 'Checking…' : 'Verify database now'}</Button></CardContent></Card>
    </div>
    {verification && <Card><CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">Latest verification</CardTitle><Badge variant={verification.ok ? 'secondary' : 'destructive'}>{verification.ok ? 'Passed' : 'Issues found'}</Badge></div><CardDescription>Checked {new Date(verification.checkedAt).toLocaleString()}. No data is changed by verification.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="mb-2 text-sm font-medium">SQLite integrity</p>{verification.integrity.map((line, index) => <p key={index} className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4" />{line}</p>)}</div><div><p className="mb-2 text-sm font-medium">Tables and records</p><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">{Object.entries(verification.tableCounts).map(([table, count]) => <div key={table} className="contents"><span>{table.replaceAll('_', ' ')}</span><span className="text-right tabular-nums">{count}</span></div>)}</div></div>{verification.foreignKeyViolations.length > 0 && <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium text-destructive">Foreign-key violations</p><pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(verification.foreignKeyViolations, null, 2)}</pre></div>}</CardContent></Card>}
    <p className="text-xs text-muted-foreground">SQLite is a local single-office database. These tools do not synchronize multiple PCs or merge data. For a restore, close the app, preserve the current database, replace it with a verified backup, then reopen and inspect records.</p>
  </section>
}
