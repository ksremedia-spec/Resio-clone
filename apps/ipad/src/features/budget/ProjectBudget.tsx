import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Sheet, Skeleton, Stat, StatusBadge, Switch, useErrorToast, useToast } from '../../ui/components';
import { dateShort, humanize, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { CostCodeSelect, Money, MoneyInput, pct, useCostCodes } from '../financial/shared';

export default function ProjectBudget({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const navigate = useNavigate();
  const base = `/v1/projects/${project.id}/budget`;
  const { data: budget, error, refetch } = useResource<contracts.Budget>(base);
  const [lineId, setLineId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (error && !budget) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  if (!budget) return <div className="page-inner"><Skeleton lines={6} /></div>;
  const t = budget.totals;
  const c = budget.contract;
  const canWrite = session.has('budget.write');
  const groups = new Map<string, contracts.BudgetLine[]>();
  for (const l of budget.lines) { const k = l.sectionName || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(l); }
  const sum = (ls: contracts.BudgetLine[], k: keyof contracts.BudgetLine) => ls.reduce((n, l) => n + (l[k] as number), 0);
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <StatusBadge status={t.status} /><span className="subtle">{pct(t.percentSpentBp)} of the revised budget is spent or committed</span>
        <span className="grow" />
        {canWrite && <Button icon="plus" onClick={() => setAdding(true)}>Budget line</Button>}
        {session.has('estimates.read') && <Button variant="quiet" icon="estimating" onClick={() => navigate(`/projects/${project.id}/estimate`)}>Estimate</Button>}
      </div>
      <div className="stat-row">
        <Stat label="Revised budget" value={money(t.revisedCents)} />
        <Stat label="Committed" value={money(t.committedCents)} />
        <Stat label="Actual cost" value={money(t.actualCents)} />
        <Stat label="Projected" value={money(t.projectedCents)} tone={t.status === 'over' ? 'danger' : t.status === 'warning' ? 'warn' : undefined} />
        <Stat label="Variance" value={<Money cents={t.varianceCents} signed />} tone={t.varianceCents < 0 ? 'danger' : 'ok'} />
        <Stat label="Projected margin" value={money(c.projectedMarginCents)} tone={c.projectedMarginCents < 0 ? 'danger' : undefined} />
      </div>
      <Card title="Contract">
        <div className="totals">
          <div className="row-between"><span className="muted">Contract value</span><Money cents={c.contractValueCents} /></div>
          <div className="row-between"><span className="muted">Approved changes</span><Money cents={c.approvedChangesCents} signed /></div>
          <div className="row-between"><span className="muted">Revised contract</span><strong className="mono">{money(c.revisedContractCents)}</strong></div>
          <div className="row-between"><span className="muted">Invoiced</span><Money cents={c.invoicedCents} /></div>
          <div className="row-between"><span className="muted">Paid</span><Money cents={c.paidCents} /></div>
          <div className="row-between"><span className="muted">Outstanding</span><Money cents={c.outstandingCents} /></div>
        </div>
      </Card>
      {budget.lines.length === 0 && <EmptyState icon="budget" title="No budget yet" action={session.has('estimates.write') ? <Button variant="primary" onClick={() => navigate(`/projects/${project.id}/estimate`)}>Open the estimate</Button> : undefined}>Lock the estimate to create the budget from its costs, or add budget lines by hand.</EmptyState>}
      {budget.lines.length > 0 && <Card title="Job costing" actions={<span className="subtle">Tap a line for every transaction behind it</span>}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Line</th><th className="num">Original</th><th className="num">Changes</th><th className="num">Revised</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Projected</th><th className="num">Variance</th><th>Status</th></tr></thead>
          <tbody>
            {[...groups.entries()].map(([name, ls]) => <FragmentRows key={name} name={name} lines={ls} sum={sum} onOpen={setLineId} />)}
            <tr className="subtotal"><td>Total</td><td className="num"><Money cents={t.originalCents} /></td><td className="num"><Money cents={t.approvedChangesCents} signed /></td><td className="num"><Money cents={t.revisedCents} /></td><td className="num"><Money cents={t.committedCents} /></td><td className="num"><Money cents={t.actualCents} /></td><td className="num"><Money cents={t.projectedCents} /></td><td className="num"><Money cents={t.varianceCents} signed /></td><td><StatusBadge status={t.status} /></td></tr>
          </tbody>
        </table></div>
      </Card>}
      {lineId && <LineDetailSheet base={base} projectId={project.id} lineId={lineId} canWrite={canWrite} onClose={() => setLineId(null)} />}
      {adding && <NewLineSheet base={base} onClose={() => setAdding(false)} />}
    </div>
  );
}

function FragmentRows({ name, lines, sum, onOpen }: { name: string; lines: contracts.BudgetLine[]; sum: (ls: contracts.BudgetLine[], k: keyof contracts.BudgetLine) => number; onOpen: (id: string) => void }) {
  return <>
    <tr><td colSpan={9} className="subtle" style={{ background: 'var(--bg-sunken)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--fs-xs)' }}>{name} · {money(sum(lines, 'revisedCents'))}</td></tr>
    {lines.map((l) => <tr key={l.id} className="clickable" data-testid="budget-line" onClick={() => onOpen(l.id)}>
      <td className="name"><div className="primary">{l.name}</div><div className="secondary">{l.costCode ?? ''}</div></td>
      <td className="num"><Money cents={l.originalCents} /></td>
      <td className="num"><Money cents={l.approvedChangesCents} signed /></td>
      <td className="num"><Money cents={l.revisedCents} /></td>
      <td className="num"><Money cents={l.committedCents} muted={!l.committedCents} /></td>
      <td className="num"><Money cents={l.actualCents} muted={!l.actualCents} /></td>
      <td className="num"><Money cents={l.projectedCents} /></td>
      <td className="num"><Money cents={l.varianceCents} signed /></td>
      <td><span className="row" style={{ gap: 6 }}><span className={`status-dot ${l.status}`} />{humanize(l.status)}</span></td>
    </tr>)}
  </>;
}

function LineDetailSheet({ base, projectId, lineId, canWrite, onClose }: { base: string; projectId: string; lineId: string; canWrite: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const errorToast = useErrorToast();
  const toast = useToast();
  const { data } = useResource<{ line: contracts.BudgetLine; transactions: Array<{ kind: string; id: string; number: string; title: string; status: string; date: string | null; amountCents: number; link: string }> }>(`${base}/lines/${lineId}`);
  const [extra, setExtra] = useState<number | null>(null);
  const save = useApiMutation((body: Record<string, unknown>) => api.mutate('PATCH', `${base}/lines/${lineId}`, body), [base, '/v1/budget', '/v1/dashboard']);
  if (!data) return <Sheet open onClose={onClose} title="Budget line"><Skeleton lines={5} /></Sheet>;
  const l = data.line;
  return <Sheet open onClose={onClose} title={l.name} size="lg" footer={<><Button onClick={onClose}>Close</Button>{canWrite && extra != null && extra !== l.projectedExtraCents && <Button variant="primary" loading={save.isPending} onClick={async () => { try { await save.mutateAsync({ projectedExtraCents: extra }); toast({ message: 'Forecast saved.', tone: 'success' }); setExtra(null); } catch (e) { errorToast(e); } }}>Save forecast</Button>}</>}>
    <div className="row wrap mb-4"><StatusBadge status={l.status} />{l.costCode && <Badge>{l.costCode}</Badge>}{l.sectionName && <Badge>{l.sectionName}</Badge>}<span className="subtle">{pct(l.percentSpentBp)} spent or committed</span></div>
    <div className="totals mb-4">
      <div className="row-between"><span className="muted">Original</span><Money cents={l.originalCents} /></div>
      <div className="row-between"><span className="muted">Approved changes</span><Money cents={l.approvedChangesCents} signed /></div>
      <div className="row-between"><span className="muted">Revised</span><strong className="mono">{money(l.revisedCents)}</strong></div>
      <div className="row-between"><span className="muted">Committed (open POs)</span><Money cents={l.committedCents} /></div>
      <div className="row-between"><span className="muted">Actual (bills + labor)</span><Money cents={l.actualCents} /></div>
      <div className="row-between"><span className="muted">Invoiced to client</span><Money cents={l.invoicedCents} /></div>
      <div className="row-between"><span className="muted">Projected</span><Money cents={l.projectedCents} /></div>
      <div className="row-between"><span className="muted">Variance</span><Money cents={l.varianceCents} signed /></div>
    </div>
    {canWrite && <Field label="Forecast adjustment" hint="Extra cost you expect beyond what is committed (or a negative saving)."><MoneyInput allowNegative value={extra ?? l.projectedExtraCents} onChange={setExtra} aria-label="Forecast adjustment" /></Field>}
    <h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Transactions</h3>
    {data.transactions.length === 0 ? <p className="muted">Nothing has been charged to this line yet.</p> : <div className="table-wrap"><table className="table">
      <thead><tr><th>Type</th><th>Reference</th><th>Status</th><th>Date</th><th className="num">Amount</th></tr></thead>
      <tbody>{data.transactions.map((x) => <tr key={`${x.kind}-${x.id}`} className="clickable" onClick={() => { onClose(); navigate(x.link.startsWith('/projects') ? x.link : `/projects/${projectId}`); }}><td>{humanize(x.kind)}</td><td>{x.number}{x.title && x.title !== x.number ? ` · ${x.title}` : ''}</td><td><StatusBadge status={x.status} /></td><td>{dateShort(x.date)}</td><td className="num"><Money cents={x.amountCents} /></td></tr>)}</tbody>
    </table></div>}
  </Sheet>;
}

function NewLineSheet({ base, onClose }: { base: string; onClose: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: codes } = useCostCodes();
  const [form, setForm] = useState({ name: '', sectionName: '', costCodeId: null as string | null, originalCents: 0, originalSellCents: 0, clientVisible: false });
  const save = useApiMutation(() => api.mutate('POST', `${base}/lines`, form), [base, '/v1/budget']);
  return <Sheet open onClose={onClose} title="New budget line" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim()) { toast({ message: 'Give the line a name.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); } }}>Add line</Button></>}>
    <div className="form-grid">
      <Field label="Name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Permit fees" /></Field>
      <Field label="Section"><Input value={form.sectionName} onChange={(e) => setForm({ ...form, sectionName: e.target.value })} placeholder="General" /></Field>
      <Field label="Cost code"><CostCodeSelect value={form.costCodeId} onChange={(id) => setForm({ ...form, costCodeId: id })} codes={codes} /></Field>
      <Field label="Budgeted cost"><MoneyInput value={form.originalCents} onChange={(v) => setForm({ ...form, originalCents: v })} aria-label="Budgeted cost" /></Field>
      <Field label="Sell value" hint="What the client is charged for this line."><MoneyInput value={form.originalSellCents} onChange={(v) => setForm({ ...form, originalSellCents: v })} aria-label="Sell value" /></Field>
      <div className="full"><Switch label="Visible to client" checked={form.clientVisible} onChange={(v) => setForm({ ...form, clientVisible: v })} /></div>
    </div>
  </Sheet>;
}
