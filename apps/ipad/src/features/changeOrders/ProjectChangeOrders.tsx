import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { formatQuantity, type contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Segmented, Select, Sheet, Skeleton, Stat, StatusBadge, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { BudgetLineSelect, CostTypeFields, Money, QuantityInput, sumCost } from '../financial/shared';

const REASONS = ['client_request', 'unforeseen_condition', 'design_change', 'code_requirement', 'allowance_overage', 'other'];
const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/change-orders', '/v1/budget', '/v1/dashboard', '/v1/invoices'];

export default function ProjectChangeOrders({ project }: { project: contracts.ProjectDetail }) {
  const { coId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'all' | 'open' | 'approved'>('all');
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.ChangeOrder[] }>(`/v1/projects/${project.id}/change-orders?status=${status}&limit=200`);
  const items = data?.items ?? [];
  const approved = items.filter((c) => c.status === 'approved');
  const pending = items.filter((c) => ['sent', 'viewed', 'pending_internal'].includes(c.status));
  const canWrite = session.has('change_orders.write');
  const creating = params.get('new') === '1';
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <Segmented value={status} onChange={setStatus} ariaLabel="Change order filter" options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'approved', label: 'Approved' }]} />
        <span className="grow" />
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New change order</Button>}
      </div>
      <div className="stat-row">
        <Stat label="Approved changes" value={money(project.financials.approvedChangesCents)} />
        <Stat label="Revised contract" value={money(project.financials.revisedContractCents)} />
        <Stat label="Awaiting decision" value={pending.length} tone={pending.length ? 'warn' : undefined} />
        <Stat label="Approved" value={approved.length} />
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
      {data && items.length === 0 && <EmptyState icon="edit" title="No change orders" action={canWrite ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Create one</Button> : undefined}>Price extra or removed work, send it to the client for a decision, and the approved amount lands on the contract and budget automatically.</EmptyState>}
      {items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((c) => <button key={c.id} className="list-row" data-testid="co-row" onClick={() => navigate(`/projects/${project.id}/change-orders/${c.id}`)}>
        <span className="grow"><div className="primary">#{c.number} · {c.title}</div><div className="secondary">{c.reason ? `${c.reason.replace(/_/g, ' ')} · ` : ''}{c.lines.length} line{c.lines.length === 1 ? '' : 's'}{c.scheduleImpactDays ? ` · ${c.scheduleImpactDays > 0 ? '+' : ''}${c.scheduleImpactDays} days` : ''}{c.decidedAt ? ` · decided ${dateShort(c.decidedAt)}` : c.sentAt ? ` · sent ${dateShort(c.sentAt)}` : ''}</div></span>
        <span className="trailing"><Money cents={c.totalCents} /><StatusBadge status={c.status} /><Icon name="chevronRight" size={16} /></span>
      </button>)}</div></div>}
      {creating && <ChangeOrderSheet project={project} onClose={() => setParams({})} onSaved={(c) => navigate(`/projects/${project.id}/change-orders/${c.id}`)} />}
      {coId && <ChangeOrderDetail project={project} coId={coId} onClose={() => navigate(`/projects/${project.id}/change-orders`)} />}
    </div>
  );
}

function ChangeOrderDetail({ project, coId, onClose }: { project: contracts.ProjectDetail; coId: string; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: co, refetch } = useResource<contracts.ChangeOrder>(`/v1/change-orders/${coId}`);
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<null | 'approved' | 'declined'>(null);
  const [voiding, setVoiding] = useState(false);
  const act = useApiMutation((path: string) => api.mutate('POST', `/v1/change-orders/${coId}/${path}`, {}), [...inv(project.id), `/v1/change-orders/${coId}`]);
  if (!co) return <Sheet open onClose={onClose} title="Change order"><Skeleton lines={5} /></Sheet>;
  const canWrite = session.has('change_orders.write');
  const portal = !!session.membership?.external;
  const editable = ['draft', 'pending_internal'].includes(co.status);
  const decidable = portal ? ['sent', 'viewed'].includes(co.status) : ['sent', 'viewed', 'draft', 'pending_internal'].includes(co.status);
  return <Sheet open onClose={onClose} title={`Change order #${co.number}`} size="lg" footer={<>
    {canWrite && editable && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    <span className="grow" />
    {canWrite && editable && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && editable && <Button icon="send" onClick={() => act.mutateAsync('send').then(() => { toast({ message: 'Sent to the client for approval.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Send to client</Button>}
    {(canWrite || portal) && decidable && <Button onClick={() => setDeciding('declined')}>Decline</Button>}
    {(canWrite || portal) && decidable && <Button variant="primary" icon="check" onClick={() => setDeciding('approved')}>{portal ? 'Approve' : 'Record approval'}</Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={co.status} /><strong style={{ fontSize: 'var(--fs-lg)' }}>{co.title}</strong>{co.reason && <Badge>{co.reason.replace(/_/g, ' ')}</Badge>}{!!co.scheduleImpactDays && <Badge tone="warning">{co.scheduleImpactDays > 0 ? '+' : ''}{co.scheduleImpactDays} schedule days</Badge>}{co.invoiceId && <Badge tone="info">invoiced</Badge>}</div>
    {co.description && <p className="muted mb-4" style={{ whiteSpace: 'pre-wrap' }}>{co.description}</p>}
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Line</th><th className="num">Qty</th>{!portal && <th className="num">Unit cost</th>}{!portal && <th className="num">Cost</th>}<th className="num">{portal ? 'Price' : 'Sell'}</th></tr></thead>
      <tbody>{co.lines.map((l) => <tr key={l.id}><td className="name"><div className="primary">{l.name}</div><div className="secondary">{portal ? l.description : [l.budgetLineName ? `Budget: ${l.budgetLineName}` : 'New budget line on approval', l.taxable ? 'taxable' : ''].filter(Boolean).join(' · ')}</div></td><td className="num">{formatQuantity(l.quantityThousandths)} {l.unit}</td>{!portal && <td className="num"><Money cents={sumCost(l.unitCostCents)} /></td>}{!portal && <td className="num"><Money cents={l.costCents} /></td>}<td className="num"><Money cents={l.sellCents} /></td></tr>)}</tbody>
    </table></div>
    <div className="totals mt-4">
      {!portal && <div className="row-between"><span className="muted">Cost</span><Money cents={co.costCents} /></div>}
      {!portal && <div className="row-between"><span className="muted">Markup</span><Money cents={co.markupCents} /></div>}
      <div className="row-between"><span className="muted">Tax</span><Money cents={co.taxCents} /></div>
      <div className="row-between"><span className="muted">Total to client</span><strong className="mono">{money(co.totalCents)}</strong></div>
    </div>
    {co.approvals.length > 0 && <><h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Approval history</h3><div className="stack-sm">{co.approvals.map((a) => <div key={a.id} className="row-between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}><span><StatusBadge status={a.status} /> {a.decidedByName ? `${a.decidedByName}` : 'Awaiting client'}{a.decisionNote ? ` — “${a.decisionNote}”` : ''}</span><span className="subtle">{dateTime(a.decidedAt ?? a.requestedAt)}</span></div>)}</div></>}
    {editing && <ChangeOrderSheet project={project} co={co} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    {deciding && <DecisionSheet coId={coId} projectId={project.id} decision={deciding} portal={portal} totalCents={co.totalCents} onClose={() => setDeciding(null)} onSaved={() => void refetch()} />}
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this change order?" confirmLabel="Void" message="It stays in the history but no longer counts toward anything." onConfirm={async () => { try { await act.mutateAsync('void'); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

type LineDraft = { id?: string; name: string; description: string; budgetLineId: string | null; quantityThousandths: number; unit: string; unitCostCents: Record<string, number>; taxable: boolean };
const emptyLine = (): LineDraft => ({ name: '', description: '', budgetLineId: null, quantityThousandths: 1000, unit: 'ea', unitCostCents: {}, taxable: false });

function ChangeOrderSheet({ project, co, onClose, onSaved }: { project: contracts.ProjectDetail; co?: contracts.ChangeOrder; onClose: () => void; onSaved: (c: contracts.ChangeOrder) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: budget } = useResource<contracts.Budget>(`/v1/projects/${project.id}/budget`);
  const [form, setForm] = useState({ title: co?.title ?? '', description: co?.description ?? '', reason: co?.reason ?? 'client_request', scheduleImpactDays: co?.scheduleImpactDays ?? 0 });
  const [lines, setLines] = useState<LineDraft[]>(co ? co.lines.map((l) => ({ id: l.id, name: l.name, description: l.description, budgetLineId: l.budgetLineId, quantityThousandths: l.quantityThousandths, unit: l.unit, unitCostCents: { ...(l.unitCostCents as Record<string, number>) }, taxable: l.taxable })) : [emptyLine()]);
  const save = useApiMutation(() => { const body = { ...form, lines }; return co ? api.mutate<contracts.ChangeOrder>('PATCH', `/v1/change-orders/${co.id}`, body) : api.mutate<contracts.ChangeOrder>('POST', `/v1/projects/${project.id}/change-orders`, body); }, [...inv(project.id), ...(co ? [`/v1/change-orders/${co.id}`] : [])]);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const cost = lines.reduce((n, l) => n + Math.round(sumCost(l.unitCostCents) * l.quantityThousandths / 1000), 0);
  return <Sheet open onClose={onClose} title={co ? `Edit change order #${co.number}` : 'New change order'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.title.trim()) { toast({ message: 'Give the change order a title.', tone: 'error' }); return; } if (lines.some((l) => !l.name.trim())) { toast({ message: 'Every line needs a name.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: co ? 'Change order updated.' : 'Change order created.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{co ? 'Save' : 'Create'}</Button></>}>
    <div className="form-grid">
      <Field label="Title" className="full"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="Add pantry cabinets" /></Field>
      <Field label="Reason"><Select value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</Select></Field>
      <Field label="Schedule impact (days)"><Input type="number" value={form.scheduleImpactDays} onChange={(e) => setForm({ ...form, scheduleImpactDays: Number(e.target.value) })} /></Field>
      <Field label="Description for the client" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </div>
    <h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Lines</h3>
    <div className="line-editor">
      {lines.map((l, i) => <div key={l.id ?? i} className="line" data-testid="co-line-editor">
        <div className="row"><Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Line name" aria-label="Line name" className="grow" /><Button variant="quiet" icon="trash" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} /></div>
        <div className="fields">
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Budget line</span><BudgetLineSelect value={l.budgetLineId} onChange={(id) => setLine(i, { budgetLineId: id })} lines={budget?.lines} /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Quantity</span><QuantityInput value={l.quantityThousandths} onChange={(v) => setLine(i, { quantityThousandths: v })} aria-label="Quantity" /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Unit</span><Input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></label>
        </div>
        <CostTypeFields value={l.unitCostCents} onChange={(v) => setLine(i, { unitCostCents: v })} />
        <div className="row-between"><Switch label="Taxable" checked={l.taxable} onChange={(v) => setLine(i, { taxable: v })} /><span className="subtle">Cost {money(Math.round(sumCost(l.unitCostCents) * l.quantityThousandths / 1000))}</span></div>
      </div>)}
      <div className="row-between"><Button icon="plus" onClick={() => setLines([...lines, emptyLine()])}>Add line</Button><span className="muted">Direct cost {money(cost)} · markup and tax use the estimate settings</span></div>
    </div>
  </Sheet>;
}

function DecisionSheet({ coId, projectId, decision, portal, totalCents, onClose, onSaved }: { coId: string; projectId: string; decision: 'approved' | 'declined'; portal: boolean; totalCents: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ decidedByName: '', note: '' });
  const save = useApiMutation(() => api.mutate('POST', `/v1/change-orders/${coId}/decide`, { decision, ...(portal ? {} : { decidedByName: form.decidedByName.trim() }), note: form.note || undefined }), [...inv(projectId), `/v1/change-orders/${coId}`, '/v1/portal', '/v1/approvals']);
  return <Sheet open onClose={onClose} title={portal ? (decision === 'approved' ? 'Approve this change' : 'Decline this change') : decision === 'approved' ? 'Record approval' : 'Record decline'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={decision === 'approved' ? 'primary' : 'danger'} loading={save.isPending} onClick={async () => { if (!portal && !form.decidedByName.trim()) { toast({ message: 'Enter who made the decision.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); toast({ message: decision === 'approved' ? (portal ? 'Approved. Thank you!' : 'Approved. The contract and budget are updated.') : 'Declined.', tone: 'success' }); onClose(); onSaved(); } catch (e) { errorToast(e); } }}>{decision === 'approved' ? 'Approve' : 'Decline'}</Button></>}>
    {portal && decision === 'approved' && <div className="card mb-4" style={{ background: 'var(--bg-sunken)', boxShadow: 'none' }}><div className="row-between"><span>Added to your contract</span><strong className="mono">{money(totalCents)}</strong></div><p className="subtle mt-2">Your approval is recorded with your name, the date and time.</p></div>}
    <div className="form-grid">
      {!portal && <Field label="Decided by" className="full" hint="The client contact who signed or replied."><Input value={form.decidedByName} onChange={(e) => setForm({ ...form, decidedByName: e.target.value })} autoFocus placeholder="Jane Smith" /></Field>}
      <Field label="Note" className="full"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={portal ? 'Anything your builder should know' : 'Signed copy in the Contracts folder'} /></Field>
    </div>
    {!portal && <p className="subtle"><Icon name="info" size={14} /> The decision is written to the permanent approval record with your name and time.</p>}
  </Sheet>;
}
