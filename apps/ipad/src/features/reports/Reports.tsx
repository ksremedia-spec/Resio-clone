import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { z } from 'zod';
import { useResource } from '../../api/hooks';
import { API_URL, getAuth } from '../../api/client';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Input, ListRow, Segmented, Select, Sheet, Skeleton, Stat, StatusBadge, Toolbar, useErrorToast, useIsCompact, useToast } from '../../ui/components';
import { dateShort, humanize, money } from '../../ui/format';
import { Money, pct } from '../financial/shared';

type Catalog = z.infer<typeof contracts.reportCatalogEntry>[];
type JobCost = z.infer<typeof contracts.jobCostReport>;
type Aging = z.infer<typeof contracts.arAgingReport>;
type TimeReport = z.infer<typeof contracts.timeByProjectReport>;
type Pipeline = z.infer<typeof contracts.pipelineReport>;

const ICONS: Record<string, 'budget' | 'invoices' | 'clock' | 'leads'> = { job_cost: 'budget', ar_aging: 'invoices', time_by_project: 'clock', pipeline: 'leads' };
const BUCKET_LABELS: Record<string, string> = { current: 'Not yet due', days_1_30: '1–30 days', days_31_60: '31–60 days', days_61_90: '61–90 days', days_90_plus: 'Over 90 days' };
const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Reports read the same tables as the screens, so every number here matches the page it came from. */
export default function Reports() {
  const { reportKey } = useParams();
  const navigate = useNavigate();
  const compact = useIsCompact();
  const { data: catalog, isLoading, error, refetch } = useResource<Catalog>('/v1/reports');
  const list = (
    <div className="split-list">
      {error && !catalog && <div style={{ padding: 16 }}><ErrorState error={error} retry={() => void refetch()} /></div>}
      {isLoading && !catalog && <div style={{ padding: 16 }}><Skeleton lines={4} /></div>}
      <div className="list">{catalog?.map((r) => <ListRow key={r.key} selected={r.key === reportKey} onClick={() => navigate(`/reports/${r.key}`)} leading={<Icon name={ICONS[r.key] ?? 'reports'} />} primary={r.name} secondary={r.description} trailing={<Icon name="chevronRight" size={16} />} data-testid="report-row" />)}</div>
      {catalog?.length === 0 && <EmptyState icon="reports" title="No reports available">Your role does not include the data these reports show.</EmptyState>}
    </div>
  );
  return <>
    <Toolbar title="Reports" leading={<>{compact && reportKey ? <Button variant="quiet" icon="back" onClick={() => navigate('/reports')} aria-label="Back" /> : <MenuToggle />}</>}><ToolbarActions /></Toolbar>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
      {(!compact || !reportKey) && list}
      {(!compact || reportKey) && <div className="split-detail">{reportKey ? <ReportView reportKey={reportKey} name={catalog?.find((r) => r.key === reportKey)?.name ?? humanize(reportKey)} /> : <EmptyState icon="reports" title="Choose a report">Job cost, receivables aging, time by project and the sales pipeline. Every report downloads as a spreadsheet.</EmptyState>}</div>}
    </div>
  </>;
}

function ReportView({ reportKey, name }: { reportKey: string; name: string }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const today = new Date();
  const [range, setRange] = useState({ from: iso(new Date(today.getTime() - 27 * 86_400_000)), to: iso(today) });
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const qs = reportKey === 'time_by_project' ? `?from=${range.from}&to=${range.to}` : reportKey === 'job_cost' ? `?status=${status}` : '';
  const path = `/v1/reports/${reportKey}${qs}`;
  const { data, isLoading, error, refetch, fromCache } = useResource<any>(path);
  const [csv, setCsv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { token, orgId } = getAuth();
      const res = await fetch(`${API_URL}${path}${qs ? '&' : '?'}format=csv`, { headers: { authorization: `Bearer ${token}`, 'x-organization-id': orgId ?? '' } });
      if (!res.ok) throw new Error('Could not build the spreadsheet.');
      const text = await res.text();
      const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${reportKey}.csv`;
      try {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch { /* fall through to the preview */ }
      setCsv(text);
      toast({ message: `${filename} is ready.`, tone: 'success' });
    } catch (e) { errorToast(e); } finally { setBusy(false); }
  };
  return <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
    <div className="row-between wrap">
      <div><h2>{name}</h2>{data?.generatedAt && <div className="subtle">Generated {new Date(data.generatedAt).toLocaleString()}{fromCache ? ' · from this device' : ''}</div>}</div>
      <div className="row wrap">
        {reportKey === 'time_by_project' && <><Input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" style={{ maxWidth: 160 }} /><span className="subtle">to</span><Input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" style={{ maxWidth: 160 }} /></>}
        {reportKey === 'job_cost' && <Segmented value={status} onChange={setStatus} ariaLabel="Projects" options={[{ value: 'open', label: 'Open projects' }, { value: 'all', label: 'All projects' }]} />}
        <Button icon="download" loading={busy} onClick={() => void download()} data-testid="download-csv">Download CSV</Button>
      </div>
    </div>
    {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
    {isLoading && !data && <div className="card"><Skeleton lines={6} /></div>}
    {data && reportKey === 'job_cost' && <JobCostView r={data as JobCost} />}
    {data && reportKey === 'ar_aging' && <AgingView r={data as Aging} />}
    {data && reportKey === 'time_by_project' && <TimeView r={data as TimeReport} />}
    {data && reportKey === 'pipeline' && <PipelineView r={data as Pipeline} />}
    <Sheet open={csv !== null} onClose={() => setCsv(null)} title="Spreadsheet (CSV)" footer={<><Button onClick={() => { void navigator.clipboard?.writeText(csv ?? '').then(() => toast({ message: 'Copied.', tone: 'success' })); }}>Copy</Button><Button variant="primary" onClick={() => setCsv(null)}>Done</Button></>}>
      <p className="muted">If the download did not start (some browsers block it), copy this and paste it into a new spreadsheet.</p>
      <pre className="card" style={{ whiteSpace: 'pre', overflowX: 'auto', fontSize: 12 }} data-testid="csv-preview">{csv}</pre>
    </Sheet>
  </div>;
}

function JobCostView({ r }: { r: JobCost }) {
  const navigate = useNavigate();
  const t = r.totals;
  return <>
    <div className="stat-row">
      <Stat label="Revised contracts" value={money(t.revisedContractCents)} />
      <Stat label="Revised budgets" value={money(t.revisedCents)} />
      <Stat label="Actual cost" value={money(t.actualCents)} />
      <Stat label="Projected margin" value={`${money(t.projectedMarginCents)} · ${pct(t.projectedMarginBp)}`} tone={t.projectedMarginCents < 0 ? 'danger' : 'ok'} />
    </div>
    {r.rows.length === 0 ? <EmptyState icon="budget" title="No projects to report on" /> : <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-wrap"><table className="table" data-testid="report-table">
      <thead><tr><th>Project</th><th className="num">Contract</th><th className="num">Budget</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Projected</th><th className="num">Variance</th><th className="num">Invoiced</th><th className="num">Margin</th><th>Health</th></tr></thead>
      <tbody>{r.rows.map((x) => <tr key={x.projectId} className="clickable" onClick={() => navigate(`/projects/${x.projectId}/budget`)}>
        <td className="name"><div className="primary">{x.number} · {x.name}</div><div className="secondary">{x.clientName ?? 'No client'} · {humanize(x.status)}</div></td>
        <td className="num"><Money cents={x.revisedContractCents} /></td><td className="num"><Money cents={x.revisedCents} /></td><td className="num"><Money cents={x.committedCents} /></td><td className="num"><Money cents={x.actualCents} /></td><td className="num"><Money cents={x.projectedCents} /></td><td className="num"><Money cents={x.varianceCents} signed /></td><td className="num"><Money cents={x.invoicedCents} /></td>
        <td className="num"><Money cents={x.projectedMarginCents} signed /><div className="secondary">{pct(x.projectedMarginBp)}</div></td>
        <td><StatusBadge status={x.health} /></td>
      </tr>)}
      <tr className="subtotal"><td>Total</td><td className="num"><Money cents={t.revisedContractCents} /></td><td className="num"><Money cents={t.revisedCents} /></td><td className="num"><Money cents={t.committedCents} /></td><td className="num"><Money cents={t.actualCents} /></td><td className="num"><Money cents={t.projectedCents} /></td><td className="num"><Money cents={t.varianceCents} signed /></td><td className="num"><Money cents={t.invoicedCents} /></td><td className="num"><Money cents={t.projectedMarginCents} signed /></td><td /></tr></tbody>
    </table></div></div>}
  </>;
}

function AgingView({ r }: { r: Aging }) {
  const navigate = useNavigate();
  const overdue = r.totalCents - r.buckets.current;
  return <>
    <div className="stat-row">
      <Stat label="Outstanding" value={money(r.totalCents)} />
      <Stat label="Past due" value={money(overdue)} tone={overdue > 0 ? 'warn' : 'ok'} />
      {(['days_1_30', 'days_31_60', 'days_61_90', 'days_90_plus'] as const).map((b) => <Stat key={b} label={BUCKET_LABELS[b]!} value={money(r.buckets[b])} tone={b === 'days_90_plus' && r.buckets[b] > 0 ? 'danger' : undefined} />)}
    </div>
    <div className="card-grid">
      <Card title="Unpaid invoices" wide>
        {r.rows.length === 0 ? <p className="muted">Nothing is outstanding. Nice.</p> : <div className="table-wrap"><table className="table" data-testid="report-table">
          <thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Age</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.invoiceId} className="clickable" onClick={() => navigate(`/invoices/${x.invoiceId}`)}>
            <td className="name"><div className="primary">{x.number} · {x.title}</div><div className="secondary">{x.projectName}</div></td>
            <td>{x.clientName ?? '—'}</td><td>{dateShort(x.dueDate)}</td><td className="num"><Money cents={x.totalCents} /></td><td className="num"><Money cents={x.paidCents} /></td><td className="num"><Money cents={x.balanceCents} /></td>
            <td><Badge tone={x.bucket === 'current' ? 'neutral' : x.bucket === 'days_1_30' ? 'warning' : 'danger'}>{x.daysOverdue ? `${x.daysOverdue} days late` : BUCKET_LABELS[x.bucket]}</Badge></td>
          </tr>)}</tbody>
        </table></div>}
      </Card>
      <Card title="By client">
        {r.byClient.length === 0 ? <p className="muted">—</p> : <div className="stack-sm">{r.byClient.map((c) => <div key={c.clientName} className="row-between"><span>{c.clientName}</span><span><strong>{money(c.balanceCents)}</strong>{c.overdueCents > 0 && <span className="subtle"> · {money(c.overdueCents)} late</span>}</span></div>)}</div>}
      </Card>
    </div>
  </>;
}

function TimeView({ r }: { r: TimeReport }) {
  const [open, setOpen] = useState<string | null>(null);
  return <>
    <div className="stat-row">
      <Stat label="Hours" value={hours(r.totals.seconds)} />
      <Stat label="Approved" value={hours(r.totals.approvedSeconds)} />
      <Stat label="Labour cost" value={money(r.totals.laborCostCents)} />
      <Stat label="Entries" value={r.totals.entries} />
    </div>
    {r.rows.length === 0 ? <EmptyState icon="clock" title="No time in this range">Change the dates above, or ask the crew to clock in.</EmptyState> : <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-wrap"><table className="table" data-testid="report-table">
      <thead><tr><th>Project</th><th className="num">Hours</th><th className="num">Approved</th><th className="num">Labour cost</th><th className="num">People</th></tr></thead>
      <tbody>{r.rows.map((x) => <><tr key={x.projectId ?? 'none'} className="clickable" onClick={() => setOpen(open === (x.projectId ?? 'none') ? null : (x.projectId ?? 'none'))}>
        <td className="name"><div className="primary"><Icon name={open === (x.projectId ?? 'none') ? 'chevronDown' : 'chevronRight'} size={14} /> {x.projectName}</div></td>
        <td className="num">{hours(x.seconds)}</td><td className="num">{hours(x.approvedSeconds)}</td><td className="num"><Money cents={x.laborCostCents} /></td><td className="num">{x.people.length}</td>
      </tr>{open === (x.projectId ?? 'none') && x.people.map((p) => <tr key={`${x.projectId}-${p.userId}`}><td className="name" style={{ paddingLeft: 40 }}><div className="secondary">{p.name}</div></td><td className="num">{hours(p.seconds)}</td><td /><td className="num"><Money cents={p.laborCostCents} /></td><td /></tr>)}</>)}</tbody>
    </table></div></div>}
  </>;
}

function PipelineView({ r }: { r: Pipeline }) {
  const navigate = useNavigate();
  const max = Math.max(1, ...r.stages.map((s) => s.valueCents));
  return <>
    <div className="stat-row">
      <Stat label="Open leads" value={r.openCount} />
      <Stat label="Pipeline value" value={money(r.openValueCents)} />
      <Stat label="Win rate" value={pct(r.winRateBp)} />
      <Stat label="Won" value={`${r.wonCount} · ${money(r.wonValueCents)}`} tone="ok" />
      <Stat label="Follow-ups due" value={r.followUpsDue} tone={r.followUpsDue ? 'warn' : undefined} />
    </div>
    <div className="card-grid">
      <Card title="By stage" actions={<Button size="sm" variant="quiet" onClick={() => navigate('/leads')}>Open board</Button>}>
        <div className="stack-sm" data-testid="report-table">{r.stages.map((s) => <div key={s.stage} className="stack-sm" style={{ gap: 2 }}><div className="row-between"><span>{humanize(s.stage)}</span><span className="subtle">{s.count} · {money(s.valueCents)}</span></div><div className="progress"><div style={{ width: `${Math.round((s.valueCents / max) * 100)}%`, background: s.stage === 'lost' ? 'var(--danger)' : s.stage === 'won' ? 'var(--success)' : undefined }} /></div></div>)}</div>
      </Card>
      <Card title="By source">
        {r.sources.length === 0 ? <p className="muted">No leads yet.</p> : <table className="table"><thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Won</th><th className="num">Value</th></tr></thead><tbody>{r.sources.map((s) => <tr key={s.source}><td>{humanize(s.source)}</td><td className="num">{s.count}</td><td className="num">{s.wonCount}</td><td className="num"><Money cents={s.valueCents} /></td></tr>)}</tbody></table>}
      </Card>
    </div>
  </>;
}

