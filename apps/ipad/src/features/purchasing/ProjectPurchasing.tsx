import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { formatQuantity, type contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Segmented, Select, Sheet, Skeleton, Stat, StatusBadge, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, humanize, money, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { BudgetLineSelect, Money, MoneyInput, OverBadge, QuantityInput } from '../financial/shared';
import { PaymentSheet } from '../invoices/ProjectInvoices';
import { BidRequests } from './BidRequests';

const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/purchase-orders', '/v1/bills', '/v1/budget', '/v1/vendors', '/v1/dashboard'];

export default function ProjectPurchasing({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'po' | 'bills' | 'bids') ?? (params.get('bill') ? 'bills' : params.get('bid') ? 'bids' : 'po');
  const [poStatus, setPoStatus] = useState<'open' | 'all'>('open');
  const [billStatus, setBillStatus] = useState<'open' | 'paid' | 'all'>('open');
  const { data: pos, error: poErr, refetch: refetchPos } = useResource<{ items: contracts.PurchaseOrder[] }>(session.has('purchasing.read') ? `/v1/projects/${project.id}/purchase-orders?status=${poStatus}&limit=200` : null);
  const { data: bills, error: billErr, refetch: refetchBills } = useResource<{ items: contracts.Bill[] }>(session.has('bills.read') ? `/v1/projects/${project.id}/bills?status=${billStatus}&limit=200` : null);
  const f = project.financials;
  const set = (next: Record<string, string>) => setParams(next);
  const poId = params.get('po');
  const billId = params.get('bill');
  const canPo = session.has('purchasing.write');
  const canBill = session.has('bills.write');
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <Segmented value={tab} onChange={(t) => set({ tab: t })} ariaLabel="Purchasing view" options={[{ value: 'po', label: 'Purchase orders' }, ...(session.has('bills.read') ? [{ value: 'bills' as const, label: 'Bills' }] : []), { value: 'bids' as const, label: 'Bid requests' }]} />
        {tab === 'bids' ? null : tab === 'po' ? <Segmented value={poStatus} onChange={setPoStatus} ariaLabel="PO status" options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} /> : <Segmented value={billStatus} onChange={setBillStatus} ariaLabel="Bill status" options={[{ value: 'open', label: 'Open' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]} />}
        <span className="grow" />
        {tab === 'po' && canPo && <Button variant="primary" icon="plus" onClick={() => set({ tab: 'po', new: 'po' })}>New PO</Button>}
        {tab === 'bills' && canBill && <Button variant="primary" icon="plus" onClick={() => set({ tab: 'bills', new: 'bill' })}>New bill</Button>}
        {tab === 'bids' && canPo && <Button variant="primary" icon="plus" onClick={() => set({ tab: 'bids', bid: 'new' })}>Request bids</Button>}
      </div>
      {!session.membership?.external && <div className="stat-row">
        <Stat label="Committed (open POs)" value={money(f.committedCents)} />
        <Stat label="Billed to date" value={money(f.actualCents)} />
        <Stat label="Budget" value={money(f.budgetRevisedCents)} />
        <Stat label="Unbilled commitments" value={money(Math.max(0, f.committedCents))} />
      </div>}
      {tab === 'po' && <>
        {poErr && !pos && <ErrorState error={poErr} retry={() => void refetchPos()} />}
        {!pos && !poErr && <div className="card"><Skeleton lines={4} /></div>}
        {pos && pos.items.length === 0 && <EmptyState icon="vendors" title="No purchase orders" action={canPo ? <Button variant="primary" onClick={() => set({ tab: 'po', new: 'po' })}>Create a PO</Button> : undefined}>Purchase orders commit money to a vendor against budget lines, so you can see what is spoken for before the bills arrive.</EmptyState>}
        {pos && pos.items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{pos.items.map((po) => <button key={po.id} className="list-row" data-testid="po-row" onClick={() => set({ tab: 'po', po: po.id })}>
          <span className="grow"><div className="primary">{po.number} · {po.title}</div><div className="secondary">{po.vendorName ?? 'No vendor'} · {po.lines.length} line{po.lines.length === 1 ? '' : 's'}{po.billedCents ? ` · billed ${money(po.billedCents)}` : ''}{po.issuedAt ? ` · issued ${dateShort(po.issuedAt)}` : ''}</div></span>
          <span className="trailing"><Money cents={po.totalCents} /><StatusBadge status={po.status} /><Icon name="chevronRight" size={16} /></span>
        </button>)}</div></div>}
      </>}
      {tab === 'bills' && <>
        {billErr && !bills && <ErrorState error={billErr} retry={() => void refetchBills()} />}
        {!bills && !billErr && <div className="card"><Skeleton lines={4} /></div>}
        {bills && bills.items.length === 0 && <EmptyState icon="file" title="No bills" action={canBill ? <Button variant="primary" onClick={() => set({ tab: 'bills', new: 'bill' })}>Enter a bill</Button> : undefined}>Vendor bills become actual cost on the budget once approved, and are matched against their purchase order.</EmptyState>}
        {bills && bills.items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{bills.items.map((b) => <button key={b.id} className="list-row" data-testid="bill-row" onClick={() => set({ tab: 'bills', bill: b.id })}>
          <span className="grow"><div className="primary">{b.number}{b.vendorReference ? ` · ${b.vendorReference}` : ''}</div><div className="secondary">{b.vendorName ?? 'No vendor'}{b.purchaseOrderNumber ? ` · ${b.purchaseOrderNumber}` : ' · not matched to a PO'} · due {dateShort(b.dueDate)}{b.paidCents ? ` · paid ${money(b.paidCents)}` : ''}</div></span>
          <span className="trailing"><OverBadge cents={b.overPoCents} /><Money cents={b.totalCents} /><StatusBadge status={b.status} /><Icon name="chevronRight" size={16} /></span>
        </button>)}</div></div>}
      </>}
      {tab === 'bids' && <BidRequests project={project} selectedId={params.get('bid')} onSelect={(id) => set(id ? { tab: 'bids', bid: id } : { tab: 'bids' })} creating={params.get('bid') === 'new'} onCloseCreate={() => set({ tab: 'bids' })} />}
      {params.get('new') === 'po' && <PoSheet project={project} onClose={() => set({ tab: 'po' })} onSaved={(po) => set({ tab: 'po', po: po.id })} />}
      {params.get('new') === 'bill' && <BillSheet project={project} purchaseOrderId={params.get('fromPo')} onClose={() => set({ tab: 'bills' })} onSaved={(b) => set({ tab: 'bills', bill: b.id })} />}
      {poId && <PoDetail project={project} poId={poId} onClose={() => set({ tab: 'po' })} onBill={() => set({ tab: 'bills', new: 'bill', fromPo: poId })} />}
      {billId && <BillDetail project={project} billId={billId} onClose={() => set({ tab: 'bills' })} />}
    </div>
  );
}

// ---------- purchase orders ----------

function PoDetail({ project, poId, onClose, onBill }: { project: contracts.ProjectDetail; poId: string; onClose: () => void; onBill: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: po, refetch } = useResource<contracts.PurchaseOrder>(`/v1/purchase-orders/${poId}`);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const act = useApiMutation((action: string) => api.mutate('POST', `/v1/purchase-orders/${poId}/transition`, { action }), [...inv(project.id), `/v1/purchase-orders/${poId}`]);
  if (!po) return <Sheet open onClose={onClose} title="Purchase order"><Skeleton lines={5} /></Sheet>;
  const canWrite = session.has('purchasing.write');
  const run = (action: string, msg: string) => act.mutateAsync(action).then(() => { toast({ message: msg, tone: 'success' }); void refetch(); }).catch(errorToast);
  return <Sheet open onClose={onClose} title={po.number} size="lg" footer={<>
    {canWrite && !['void', 'closed'].includes(po.status) && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    {canWrite && ['void', 'closed'].includes(po.status) && <Button onClick={() => run('reopen', 'Reopened.')}>Reopen</Button>}
    <span className="grow" />
    {canWrite && ['draft', 'awaiting_approval'].includes(po.status) && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && po.status === 'draft' && <Button onClick={() => run('submit', 'Submitted for approval.')}>Submit for approval</Button>}
    {canWrite && ['draft', 'awaiting_approval'].includes(po.status) && <Button variant="primary" icon="check" onClick={() => run('approve', 'Approved. The amount is now committed on the budget.')}>Approve</Button>}
    {canWrite && po.status === 'approved' && <Button variant="primary" icon="send" onClick={() => run('issue', 'Issued to the vendor.')}>Issue to vendor</Button>}
    {session.has('bills.write') && ['approved', 'committed', 'matched'].includes(po.status) && po.billedCents < po.totalCents && <Button icon="file" onClick={() => { onClose(); onBill(); }}>Enter bill</Button>}
    {canWrite && ['committed', 'matched'].includes(po.status) && <Button onClick={() => run('close', 'Closed.')}>Close</Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={po.status} /><strong style={{ fontSize: 'var(--fs-lg)' }}>{po.title}</strong>{po.vendorName && <Badge>{po.vendorName}</Badge>}</div>
    <div className="subtle mb-4">{po.approvedAt ? `Approved ${dateTime(po.approvedAt)}` : 'Not yet approved'}{po.issuedAt ? ` · Issued ${dateTime(po.issuedAt)}` : ''}{po.closedAt ? ` · Closed ${dateTime(po.closedAt)}` : ''}</div>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Amount</th><th className="num">Billed</th></tr></thead>
      <tbody>{po.lines.map((l) => <tr key={l.id}><td className="name"><div className="primary">{l.description}</div><div className="secondary">{l.budgetLineName ? `Budget: ${l.budgetLineName}` : 'No budget line'}</div></td><td className="num">{formatQuantity(l.quantityThousandths)} {l.unit}</td><td className="num"><Money cents={l.unitCostCents} /></td><td className="num"><Money cents={l.amountCents} /></td><td className="num"><Money cents={l.billedCents} muted={!l.billedCents} /></td></tr>)}</tbody>
    </table></div>
    <div className="totals mt-4">
      <div className="row-between"><span className="muted">PO total</span><strong className="mono">{money(po.totalCents)}</strong></div>
      <div className="row-between"><span className="muted">Billed</span><Money cents={po.billedCents} /></div>
      <div className="row-between"><span className="muted">Remaining</span><Money cents={po.totalCents - po.billedCents} /></div>
    </div>
    {po.notes && <p className="muted mt-4" style={{ whiteSpace: 'pre-wrap' }}>{po.notes}</p>}
    {editing && <PoSheet project={project} po={po} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this purchase order?" confirmLabel="Void" message="Nothing is committed against the budget any more. Approved bills must be voided first." onConfirm={async () => { try { await act.mutateAsync('void'); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

type PoLineDraft = { id?: string; description: string; budgetLineId: string | null; quantityThousandths: number; unit: string; unitCostCents: number };
const emptyPoLine = (): PoLineDraft => ({ description: '', budgetLineId: null, quantityThousandths: 1000, unit: 'ea', unitCostCents: 0 });

function PoSheet({ project, po, onClose, onSaved }: { project: contracts.ProjectDetail; po?: contracts.PurchaseOrder; onClose: () => void; onSaved: (po: contracts.PurchaseOrder) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: vendors } = useResource<{ items: contracts.Vendor[] }>('/v1/vendors?limit=200');
  const { data: budget } = useResource<contracts.Budget>(`/v1/projects/${project.id}/budget`);
  const [form, setForm] = useState({ vendorId: po?.vendorId ?? '', title: po?.title ?? '', notes: po?.notes ?? '' });
  const [lines, setLines] = useState<PoLineDraft[]>(po ? po.lines.map((l) => ({ id: l.id, description: l.description, budgetLineId: l.budgetLineId, quantityThousandths: l.quantityThousandths, unit: l.unit, unitCostCents: l.unitCostCents })) : [emptyPoLine()]);
  const setLine = (i: number, patch: Partial<PoLineDraft>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const total = lines.reduce((n, l) => n + Math.round(l.unitCostCents * l.quantityThousandths / 1000), 0);
  const save = useApiMutation(() => { const body = { ...form, vendorId: form.vendorId || null, lines }; return po ? api.mutate<contracts.PurchaseOrder>('PATCH', `/v1/purchase-orders/${po.id}`, body) : api.mutate<contracts.PurchaseOrder>('POST', `/v1/projects/${project.id}/purchase-orders`, body); }, [...inv(project.id), ...(po ? [`/v1/purchase-orders/${po.id}`] : [])]);
  return <Sheet open onClose={onClose} title={po ? `Edit ${po.number}` : 'New purchase order'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.title.trim()) { toast({ message: 'Give the PO a title.', tone: 'error' }); return; } if (lines.some((l) => !l.description.trim())) { toast({ message: 'Every line needs a description.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: po ? 'Purchase order updated.' : 'Purchase order created.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{po ? 'Save' : 'Create'}</Button></>}>
    <div className="form-grid">
      <Field label="Title" className="full"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="Kitchen cabinets" /></Field>
      <Field label="Vendor" className="full"><Select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}><option value="">Choose a vendor</option>{vendors?.items.map((v) => <option key={v.id} value={v.id}>{v.name}{v.trade ? ` · ${v.trade}` : ''}</option>)}</Select></Field>
      <Field label="Notes to vendor" className="full"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>
    <h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Lines</h3>
    <div className="line-editor">
      {lines.map((l, i) => <div key={l.id ?? i} className="line" data-testid="po-line-editor">
        <div className="row"><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" aria-label="Line description" className="grow" /><Button variant="quiet" icon="trash" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} /></div>
        <div className="fields">
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Budget line</span><BudgetLineSelect value={l.budgetLineId} onChange={(id) => setLine(i, { budgetLineId: id })} lines={budget?.lines} /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Quantity</span><QuantityInput value={l.quantityThousandths} onChange={(v) => setLine(i, { quantityThousandths: v })} aria-label="Quantity" /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Unit</span><Input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Unit cost</span><MoneyInput value={l.unitCostCents} onChange={(v) => setLine(i, { unitCostCents: v })} aria-label="Unit cost" /></label>
        </div>
        <div className="row-between"><span /><strong className="mono">{money(Math.round(l.unitCostCents * l.quantityThousandths / 1000))}</strong></div>
      </div>)}
      <div className="row-between"><Button icon="plus" onClick={() => setLines([...lines, emptyPoLine()])}>Add line</Button><strong>Total {money(total)}</strong></div>
    </div>
  </Sheet>;
}

// ---------- bills ----------

function BillDetail({ project, billId, onClose }: { project: contracts.ProjectDetail; billId: string; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: b, refetch } = useResource<contracts.Bill>(`/v1/bills/${billId}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const keys = [...inv(project.id), `/v1/bills/${billId}`];
  const act = useApiMutation((action: string) => api.mutate('POST', `/v1/bills/${billId}/transition`, { action }), keys);
  if (!b) return <Sheet open onClose={onClose} title="Bill"><Skeleton lines={5} /></Sheet>;
  const canWrite = session.has('bills.write');
  const run = (action: string, msg: string) => act.mutateAsync(action).then(() => { toast({ message: msg, tone: 'success' }); void refetch(); }).catch(errorToast);
  return <Sheet open onClose={onClose} title={b.number} size="lg" footer={<>
    {canWrite && ['draft', 'approved', 'scheduled'].includes(b.status) && b.paidCents === 0 && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    {canWrite && b.status === 'void' && <Button onClick={() => run('reopen', 'Reopened as a draft.')}>Reopen</Button>}
    <span className="grow" />
    {canWrite && b.status === 'draft' && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && b.status === 'draft' && <Button variant="primary" icon="check" onClick={() => run('approve', 'Approved. It now counts as actual cost.')}>Approve</Button>}
    {canWrite && b.status === 'approved' && <Button onClick={() => run('schedule', 'Scheduled for payment.')}>Schedule payment</Button>}
    {(canWrite || session.has('payments.write')) && ['approved', 'scheduled'].includes(b.status) && <Button variant="primary" icon="check" onClick={() => setPaying(true)}>Pay</Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={b.status} /><strong style={{ fontSize: 'var(--fs-lg)' }}>{b.vendorName ?? 'No vendor'}</strong>{b.vendorReference && <Badge>ref {b.vendorReference}</Badge>}{b.purchaseOrderNumber && <Badge tone="brand">{b.purchaseOrderNumber}</Badge>}<OverBadge cents={b.overPoCents} /></div>
    {!!b.overPoCents && <div className="banner offline mb-4" style={{ borderRadius: 8 }}><Icon name="alert" size={16} />This bill takes the purchase order {money(b.overPoCents)} over its total. Check it before approving.</div>}
    <div className="subtle mb-4">Bill date {dateShort(b.billDate)} · Due {dateShort(b.dueDate)}</div>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Description</th><th>Budget line</th><th className="num">Amount</th></tr></thead>
      <tbody>{b.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="muted">{l.budgetLineName ?? '—'}</td><td className="num"><Money cents={l.amountCents} /></td></tr>)}</tbody>
    </table></div>
    <div className="totals mt-4">
      <div className="row-between"><span className="muted">Subtotal</span><Money cents={b.subtotalCents} /></div>
      <div className="row-between"><span className="muted">Tax</span><Money cents={b.taxCents} /></div>
      <div className="row-between"><span className="muted">Total</span><strong className="mono">{money(b.totalCents)}</strong></div>
      <div className="row-between"><span className="muted">Paid</span><Money cents={b.paidCents} /></div>
    </div>
    {b.notes && <p className="muted mt-4" style={{ whiteSpace: 'pre-wrap' }}>{b.notes}</p>}
    {editing && <BillSheet project={project} bill={b} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    {paying && <PaymentSheet direction="out" path={`/v1/bills/${billId}/payments`} max={b.totalCents - b.paidCents} keys={keys} onClose={() => setPaying(false)} onSaved={() => void refetch()} />}
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this bill?" confirmLabel="Void" message="It no longer counts as cost and is released from its purchase order." onConfirm={async () => { try { await act.mutateAsync('void'); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

type BillLineDraft = { id?: string; description: string; budgetLineId: string | null; purchaseOrderLineId: string | null; amountCents: number };

function BillSheet({ project, bill, purchaseOrderId, onClose, onSaved }: { project: contracts.ProjectDetail; bill?: contracts.Bill; purchaseOrderId?: string | null; onClose: () => void; onSaved: (b: contracts.Bill) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: vendors } = useResource<{ items: contracts.Vendor[] }>('/v1/vendors?limit=200');
  const { data: budget } = useResource<contracts.Budget>(`/v1/projects/${project.id}/budget`);
  const { data: pos } = useResource<{ items: contracts.PurchaseOrder[] }>(`/v1/projects/${project.id}/purchase-orders?status=open&limit=200`);
  const [form, setForm] = useState({ vendorId: bill?.vendorId ?? '', purchaseOrderId: bill?.purchaseOrderId ?? purchaseOrderId ?? '', vendorReference: bill?.vendorReference ?? '', billDate: bill?.billDate ?? todayIso(), dueDate: bill?.dueDate ?? '', taxCents: bill?.taxCents ?? 0, notes: bill?.notes ?? '' });
  const [lines, setLines] = useState<BillLineDraft[] | null>(bill ? bill.lines.map((l) => ({ id: l.id, description: l.description, budgetLineId: l.budgetLineId, purchaseOrderLineId: l.purchaseOrderLineId, amountCents: l.amountCents })) : purchaseOrderId ? null : [{ description: '', budgetLineId: null, purchaseOrderLineId: null, amountCents: 0 }]);
  const po = pos?.items.find((p) => p.id === form.purchaseOrderId);
  // Choosing a PO pre-fills the vendor and, until edited, bills whatever is still unbilled on it.
  const effectiveLines: BillLineDraft[] = lines ?? (po ? po.lines.filter((l) => l.amountCents - l.billedCents > 0).map((l) => ({ description: l.description, budgetLineId: l.budgetLineId, purchaseOrderLineId: l.id, amountCents: l.amountCents - l.billedCents })) : []);
  const setLine = (i: number, patch: Partial<BillLineDraft>) => setLines(effectiveLines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const subtotal = effectiveLines.reduce((n, l) => n + l.amountCents, 0);
  const save = useApiMutation(() => { const body = { projectId: project.id, vendorId: (form.vendorId || po?.vendorId) || null, purchaseOrderId: form.purchaseOrderId || null, vendorReference: form.vendorReference || null, billDate: form.billDate || null, dueDate: form.dueDate || null, taxCents: form.taxCents, notes: form.notes, lines: effectiveLines }; return bill ? api.mutate<contracts.Bill>('PATCH', `/v1/bills/${bill.id}`, body) : api.mutate<contracts.Bill>('POST', '/v1/bills', body); }, [...inv(project.id), ...(bill ? [`/v1/bills/${bill.id}`] : [])]);
  return <Sheet open onClose={onClose} title={bill ? `Edit ${bill.number}` : 'New bill'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (effectiveLines.length === 0 || effectiveLines.some((l) => !l.description.trim())) { toast({ message: 'Add at least one line with a description.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: bill ? 'Bill updated.' : 'Bill entered as a draft.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{bill ? 'Save' : 'Enter bill'}</Button></>}>
    <div className="form-grid">
      <Field label="Purchase order" className="full" hint="Matching to a PO lets Buildline warn you about over-billing."><Select value={form.purchaseOrderId} onChange={(e) => { setForm({ ...form, purchaseOrderId: e.target.value }); setLines(e.target.value ? null : effectiveLines); }}><option value="">Not matched to a PO</option>{pos?.items.filter((p) => ['approved', 'committed', 'matched'].includes(p.status)).map((p) => <option key={p.id} value={p.id}>{p.number} · {p.title} ({money(p.totalCents - p.billedCents)} unbilled)</option>)}</Select></Field>
      <Field label="Vendor"><Select value={form.vendorId || po?.vendorId || ''} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}><option value="">Choose a vendor</option>{vendors?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
      <Field label="Vendor invoice number"><Input value={form.vendorReference} onChange={(e) => setForm({ ...form, vendorReference: e.target.value })} placeholder="HCC-4471" /></Field>
      <Field label="Bill date"><Input type="date" value={form.billDate} onChange={(e) => setForm({ ...form, billDate: e.target.value })} /></Field>
      <Field label="Due date"><Input type="date" value={form.dueDate ?? ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      <Field label="Tax"><MoneyInput value={form.taxCents} onChange={(v) => setForm({ ...form, taxCents: v })} aria-label="Tax" /></Field>
      <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>
    <h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Lines</h3>
    <div className="line-editor">
      {effectiveLines.map((l, i) => <div key={l.id ?? i} className="line" data-testid="bill-line-editor">
        <div className="row"><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" aria-label="Line description" className="grow" /><Button variant="quiet" icon="trash" aria-label="Remove line" onClick={() => setLines(effectiveLines.filter((_, j) => j !== i))} /></div>
        <div className="fields">
          {po && <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">PO line</span><Select value={l.purchaseOrderLineId ?? ''} onChange={(e) => { const pl = po.lines.find((x) => x.id === e.target.value); setLine(i, { purchaseOrderLineId: e.target.value || null, budgetLineId: pl?.budgetLineId ?? l.budgetLineId }); }}><option value="">Not on the PO</option>{po.lines.map((pl) => <option key={pl.id} value={pl.id}>{pl.description} ({money(pl.amountCents - pl.billedCents)} left)</option>)}</Select></label>}
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Budget line</span><BudgetLineSelect value={l.budgetLineId} onChange={(id) => setLine(i, { budgetLineId: id })} lines={budget?.lines} /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Amount</span><MoneyInput value={l.amountCents} onChange={(v) => setLine(i, { amountCents: v })} aria-label="Amount" /></label>
        </div>
      </div>)}
      <div className="row-between"><Button icon="plus" onClick={() => setLines([...effectiveLines, { description: '', budgetLineId: null, purchaseOrderLineId: null, amountCents: 0 }])}>Add line</Button><strong>Total {money(subtotal + form.taxCents)}</strong></div>
    </div>
    {po && subtotal + form.taxCents > po.totalCents - po.billedCents && <div className="banner offline mt-4" style={{ borderRadius: 8 }}><Icon name="alert" size={16} />This bill exceeds what is left on {po.number} by {money(subtotal + form.taxCents - (po.totalCents - po.billedCents))}.</div>}
    <p className="subtle mt-2">{humanize('bills are drafts until approved')}; only approved bills count as cost.</p>
  </Sheet>;
}
