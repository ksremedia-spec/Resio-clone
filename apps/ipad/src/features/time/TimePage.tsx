import { useState } from 'react';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Segmented, Sheet, Skeleton, Stat, Textarea, Toolbar, useErrorToast, useToast } from '../../ui/components';
import { dateShort, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { ClockWidget, fmtDuration } from './ClockWidget';
import { ManualTimeSheet, TimeRow } from './ProjectTime';

const weekStart = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x.toISOString().slice(0, 10); };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Company time: this week's timesheet, approvals and payroll export. Crew see their own week. */
export default function TimePage() {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const manager = session.has('time.manage') || session.has('time.approve');
  const [from, setFrom] = useState(weekStart(new Date()));
  const to = addDays(from, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const [view, setView] = useState<'sheet' | 'entries'>('sheet');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [exporting, setExporting] = useState<null | { csv: string; count: number }>(null);
  const { data: sheet, isLoading, error, refetch } = useResource<contracts.TimesheetResponse>(`/v1/time/timesheet?from=${from}&to=${to}`);
  const { data: entries, refetch: refetchEntries } = useResource<{ items: contracts.TimeEntry[] }>(`/v1/time/entries?from=${from}&to=${to}&status=all&limit=200`);
  const decide = useApiMutation((body: { ids: string[]; decision: 'approved' | 'rejected'; note?: string }) => api.mutate('POST', '/v1/time/decide', body), ['/v1/time', '/v1/budget', '/v1/dashboard']);
  const exportCsv = useApiMutation((mark: boolean) => api.mutate<{ csv: string; count: number }>('POST', '/v1/time/payroll-export', { from, to, markExported: mark }), ['/v1/time']);
  const pending = (entries?.items ?? []).filter((e) => e.status === 'submitted');
  const act = async (decision: 'approved' | 'rejected') => { const ids = selected.size ? [...selected] : pending.map((e) => e.id); if (!ids.length) { toast({ message: 'Nothing to approve.', tone: 'error' }); return; } try { await decide.mutateAsync({ ids, decision, note: note || undefined }); toast({ message: `${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} ${decision}.`, tone: 'success' }); setSelected(new Set()); setNote(''); void refetch(); void refetchEntries(); } catch (e) { errorToast(e); } };
  return <>
    <Toolbar title="Time" leading={<MenuToggle />}>
      <Button variant="quiet" icon="chevronLeft" aria-label="Previous week" onClick={() => setFrom(addDays(from, -7))} />
      <strong>{dateShort(from)} – {dateShort(to)}</strong>
      <Button variant="quiet" icon="chevronRight" aria-label="Next week" onClick={() => setFrom(addDays(from, 7))} />
      <Button variant="quiet" onClick={() => setFrom(weekStart(new Date()))}>This week</Button>
      <span className="grow" />
      {session.has('time.clock') && <Button icon="plus" onClick={() => setAdding(true)}>Add time</Button>}
      {session.has('time.manage') && <Button icon="download" loading={exportCsv.isPending} onClick={() => exportCsv.mutateAsync(false).then((r) => setExporting(r.data)).catch(errorToast)}>Payroll export</Button>}
      <ToolbarActions />
    </Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      {session.has('time.clock') && <Card title="Time clock"><ClockWidget /></Card>}
      {error && !sheet && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !sheet && <div className="card"><Skeleton lines={5} /></div>}
      {sheet && <div className="stat-row">
        <Stat label="Hours this week" value={fmtDuration(sheet.totalSeconds)} />
        <Stat label="Awaiting approval" value={fmtDuration(sheet.rows.reduce((n, r) => n + r.pendingSeconds, 0))} tone={pending.length ? 'warn' : undefined} />
        <Stat label="Approved" value={fmtDuration(sheet.rows.reduce((n, r) => n + r.approvedSeconds, 0))} tone="ok" />
        {manager && <Stat label="Labor cost" value={money(sheet.laborCostCents)} />}
        <Stat label="People" value={sheet.rows.length} />
      </div>}
      <div className="row wrap">
        <Segmented value={view} onChange={setView} ariaLabel="Time view" options={[{ value: 'sheet', label: 'Timesheet' }, { value: 'entries', label: 'Entries' }]} />
        <span className="grow" />
        {manager && session.has('time.approve') && pending.length > 0 && <>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 240 }} aria-label="Approval note" />
          <Button onClick={() => act('rejected')}>Reject {selected.size ? selected.size : ''}</Button>
          <Button variant="primary" icon="check" loading={decide.isPending} data-testid="approve-time" onClick={() => act('approved')}>{selected.size ? `Approve ${selected.size} selected` : `Approve all pending (${pending.length})`}</Button>
        </>}
      </div>
      {view === 'sheet' && sheet && (sheet.rows.length === 0 ? <EmptyState icon="clock" title="No time this week" /> : <Card title="Hours by person">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Person</th>{days.map((d) => <th key={d} className="num">{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}<div className="subtle" style={{ fontWeight: 400 }}>{dateShort(d)}</div></th>)}<th className="num">Total</th>{manager && <th className="num">Cost</th>}<th>Status</th></tr></thead>
          <tbody>{sheet.rows.map((r) => <tr key={r.userId} data-testid="timesheet-row"><td className="name"><div className="primary">{r.userName}</div>{manager && r.hourlyCostCents != null && <div className="secondary">{money(r.hourlyCostCents)}/h</div>}</td>{days.map((d) => <td key={d} className="num">{r.days[d] ? (r.days[d]! / 3600).toFixed(1) : <span className="muted">–</span>}</td>)}<td className="num"><strong>{(r.totalSeconds / 3600).toFixed(1)}</strong></td>{manager && <td className="num mono">{money(r.laborCostCents)}</td>}<td>{r.pendingSeconds > 0 ? <Badge tone="warning">{(r.pendingSeconds / 3600).toFixed(1)}h pending</Badge> : <Badge tone="success">approved</Badge>}</td></tr>)}</tbody>
        </table></div>
      </Card>)}
      {view === 'entries' && <div className="card" style={{ padding: 0, overflow: 'hidden' }}>{!entries ? <div style={{ padding: 16 }}><Skeleton lines={4} /></div> : entries.items.length === 0 ? <EmptyState icon="clock" title="No entries this week" /> : <div className="list">{entries.items.map((e) => <div key={e.id} className="row" style={{ gap: 0 }}>{manager && e.status === 'submitted' && <label style={{ padding: '0 12px' }}><input type="checkbox" aria-label={`Select ${e.userName} ${dateShort(e.clockInAt)}`} checked={selected.has(e.id)} onChange={(ev) => { const s = new Set(selected); if (ev.target.checked) s.add(e.id); else s.delete(e.id); setSelected(s); }} /></label>}<div className="grow"><TimeRow e={e} showUser={manager} /></div></div>)}</div>}</div>}
      {adding && <ManualTimeSheet onClose={() => setAdding(false)} onSaved={() => { void refetch(); void refetchEntries(); }} />}
      {exporting && <Sheet open onClose={() => setExporting(null)} title="Payroll export" size="lg" footer={<><Button onClick={() => setExporting(null)}>Close</Button><Button onClick={() => { void navigator.clipboard?.writeText(exporting.csv); toast({ message: 'Copied to the clipboard.', tone: 'success' }); }}>Copy CSV</Button><Button variant="primary" loading={exportCsv.isPending} onClick={() => exportCsv.mutateAsync(true).then((r) => { toast({ message: `${r.data.count} entries marked exported.`, tone: 'success' }); setExporting(null); void refetch(); void refetchEntries(); }).catch(errorToast)}>Mark {exporting.count} entries exported</Button></>}>
        <p className="muted">{exporting.count} approved entr{exporting.count === 1 ? 'y' : 'ies'} between {dateShort(from)} and {dateShort(to)}. Paste into your payroll system; marking them exported stops them being paid twice.</p>
        <Field label="CSV"><Textarea readOnly value={exporting.csv} style={{ minHeight: 220, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' }} onFocus={(e) => e.currentTarget.select()} /></Field>
      </Sheet>}
    </div></div>
  </>;
}
