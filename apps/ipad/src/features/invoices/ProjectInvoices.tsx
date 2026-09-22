import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { contracts, formatQuantity } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Segmented, Select, Sheet, Skeleton, Stat, StatusBadge, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, humanize, money, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { BudgetLineSelect, Money, MoneyInput, PercentInput, QuantityInput, pct } from '../financial/shared';

const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/invoices', '/v1/budget', '/v1/dashboard', '/v1/change-orders'];

export default function ProjectInvoices({ project }: { project: contracts.ProjectDetail }) {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'all' | 'open' | 'paid' | 'draft'>('all');
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Invoice[] }>(`/v1/projects/${project.id}/invoices?status=${status}&limit=200`);
  const items = data?.items ?? [];
  const f = project.financials;
  const canWrite = session.has('invoices.write');
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <Segmented value={status} onChange={setStatus} ariaLabel="Invoice filter" options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'draft', label: 'Drafts' }]} />
        <span className="grow" />
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New invoice</Button>}
      </div>
      <div className="stat-row">
        <Stat label="Revised contract" value={money(f.revisedContractCents)} />
        <Stat label="Invoiced" value={money(f.invoicedCents)} />
        <Stat label="Paid" value={money(f.paidCents)} tone="ok" />
        <Stat label="Outstanding" value={money(f.outstandingCents)} tone={f.outstandingCents > 0 ? 'warn' : undefined} />
        <Stat label="Left to bill" value={money(Math.max(0, f.revisedContractCents - f.invoicedCents))} />
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
      {data && items.length === 0 && <EmptyState icon="invoices" title="No invoices" action={canWrite ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Create the first invoice</Button> : undefined}>Bill a percentage of the budget, a milestone, or approved change orders. Payments are tracked against each invoice.</EmptyState>}
      {items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((i) => <button key={i.id} className="list-row" data-testid="invoice-row" onClick={() => navigate(`/projects/${project.id}/invoices/${i.id}`)}>
        <span className="grow"><div className="primary">{i.number}{i.title ? ` · ${i.title}` : ''}</div><div className="secondary">{humanize(i.billingType)} · issued {dateShort(i.issueDate)} · due {dateShort(i.dueDate)}{i.paidCents ? ` · paid ${money(i.paidCents)}` : ''}</div></span>
        <span className="trailing"><span style={{ textAlign: 'right' }}><div><Money cents={i.totalCents} /></div>{i.balanceCents !== i.totalCents && i.status !== 'void' && <div className="subtle">balance {money(i.balanceCents)}</div>}</span><StatusBadge status={i.status} /><Icon name="chevronRight" size={16} /></span>
      </button>)}</div></div>}
      {params.get('new') === '1' && <InvoiceSheet project={project} onClose={() => setParams({})} onSaved={(i) => navigate(`/projects/${project.id}/invoices/${i.id}`)} />}
      {invoiceId && <InvoiceDetail project={project} invoiceId={invoiceId} onClose={() => navigate(`/projects/${project.id}/invoices`)} />}
    </div>
  );
}

export function InvoiceDetail({ project, invoiceId, onClose }: { project: { id: string }; invoiceId: string; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: i, refetch } = useResource<contracts.Invoice>(`/v1/invoices/${invoiceId}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const keys = [...inv(project.id), `/v1/invoices/${invoiceId}`];
  const act = useApiMutation((action: string) => api.mutate('POST', `/v1/invoices/${invoiceId}/transition`, { action }), keys);
  const voidPayment = useApiMutation((paymentId: string) => api.mutate('DELETE', `/v1/invoices/${invoiceId}/payments/${paymentId}`), keys);
  if (!i) return <Sheet open onClose={onClose} title="Invoice"><Skeleton lines={5} /></Sheet>;
  const canWrite = session.has('invoices.write');
  const canPay = session.has('payments.write');
  const payable = ['sent', 'viewed', 'partially_paid', 'overdue'].includes(i.status);
  return <Sheet open onClose={onClose} title={i.number} size="lg" footer={<>
    {canWrite && i.status !== 'void' && i.status !== 'paid' && i.paidCents === 0 && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    {canWrite && i.status === 'void' && <Button onClick={() => act.mutateAsync('reopen').then(() => void refetch()).catch(errorToast)}>Reopen as draft</Button>}
    <span className="grow" />
    {canWrite && i.status === 'draft' && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && i.status === 'draft' && <Button variant="primary" icon="send" onClick={() => act.mutateAsync('send').then(() => { toast({ message: 'Invoice sent.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Send to client</Button>}
    {canPay && payable && <Button variant="primary" icon="check" onClick={() => setPaying(true)}>Record payment</Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={i.status} /><strong style={{ fontSize: 'var(--fs-lg)' }}>{i.title || humanize(i.billingType)}</strong><Badge>{humanize(i.billingType)}</Badge>{i.clientName && <Badge>{i.clientName}</Badge>}</div>
    <div className="subtle mb-4">Issued {dateShort(i.issueDate)} · Due {dateShort(i.dueDate)}{i.sentAt ? ` · Sent ${dateTime(i.sentAt)}` : ''}{i.paidAt ? ` · Paid ${dateTime(i.paidAt)}` : ''}</div>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
      <tbody>{i.lines.map((l) => <tr key={l.id}><td className="name"><div className="primary">{l.description}</div><div className="secondary">{l.percentBp != null ? `${pct(l.percentBp)} of budget line` : l.changeOrderId ? 'Approved change order' : ''}{l.taxable ? ' · taxable' : ''}</div></td><td className="num">{l.percentBp != null ? pct(l.percentBp) : formatQuantity(l.quantityThousandths)}</td><td className="num">{l.percentBp != null ? '' : money(l.unitPriceCents)}</td><td className="num"><Money cents={l.amountCents} /></td></tr>)}</tbody>
    </table></div>
    <div className="totals mt-4">
      <div className="row-between"><span className="muted">Subtotal</span><Money cents={i.subtotalCents} /></div>
      <div className="row-between"><span className="muted">Tax</span><Money cents={i.taxCents} /></div>
      {i.retainageCents > 0 && <div className="row-between"><span className="muted">Retainage held</span><Money cents={-i.retainageCents} /></div>}
      <div className="row-between"><span className="muted">Total</span><strong className="mono">{money(i.totalCents)}</strong></div>
      <div className="row-between"><span className="muted">Paid</span><Money cents={i.paidCents} /></div>
      <div className="row-between"><span className="muted">Balance due</span><strong className="mono" style={{ color: i.balanceCents > 0 && i.status !== 'draft' ? 'var(--warning)' : undefined }}>{money(i.balanceCents)}</strong></div>
    </div>
    {i.payments.length > 0 && <><h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Payments</h3><div className="stack-sm">{i.payments.map((p) => <div key={p.id} className="row-between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0', opacity: p.voidedAt ? 0.6 : 1 }} data-testid="payment-row"><span>{humanize(p.method)}{p.reference ? ` #${p.reference}` : ''}{p.voidedAt && <Badge> void</Badge>}<span className="subtle"> · {dateTime(p.receivedAt)}</span></span><span className="row"><Money cents={p.amountCents} />{canPay && !p.voidedAt && <Button size="sm" variant="quiet" icon="trash" aria-label="Void payment" onClick={() => voidPayment.mutateAsync(p.id).then(() => void refetch()).catch(errorToast)} />}</span></div>)}</div></>}
    {(i.notes || i.terms) && <div className="mt-4 muted" style={{ whiteSpace: 'pre-wrap' }}>{i.notes}{i.notes && i.terms ? '\n\n' : ''}{i.terms}</div>}
    {editing && <InvoiceSheet project={project} invoice={i} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    {paying && <PaymentSheet path={`/v1/invoices/${invoiceId}/payments`} max={i.balanceCents} keys={keys} onClose={() => setPaying(false)} onSaved={() => void refetch()} />}
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this invoice?" confirmLabel="Void" message="The invoice no longer counts as billed. You can reopen it as a draft later." onConfirm={async () => { try { await act.mutateAsync('void'); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

type LineDraft = { id?: string; mode: 'amount' | 'percent'; description: string; budgetLineId: string | null; quantityThousandths: number; unitPriceCents: number; percentBp: number; taxable: boolean };
const emptyLine = (): LineDraft => ({ mode: 'amount', description: '', budgetLineId: null, quantityThousandths: 1000, unitPriceCents: 0, percentBp: 0, taxable: false });

function InvoiceSheet({ project, invoice, onClose, onSaved }: { project: { id: string }; invoice?: contracts.Invoice; onClose: () => void; onSaved: (i: contracts.Invoice) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: budget } = useResource<contracts.Budget>(`/v1/projects/${project.id}/budget`);
  const { data: cos } = useResource<{ items: contracts.ChangeOrder[] }>(`/v1/projects/${project.id}/change-orders?status=approved&limit=100`);
  const [form, setForm] = useState({ title: invoice?.title ?? '', billingType: invoice?.billingType ?? 'progress', issueDate: invoice?.issueDate ?? todayIso(), dueDate: invoice?.dueDate ?? '', taxBp: invoice ? (invoice.taxCents && invoice.subtotalCents ? Math.round((invoice.taxCents / invoice.lines.filter((l) => l.taxable).reduce((n, l) => n + l.amountCents, 0 || 1)) * 10_000) : 0) : 0, retainageBp: invoice && invoice.subtotalCents ? Math.round((invoice.retainageCents / invoice.subtotalCents) * 10_000) : 0, notes: invoice?.notes ?? '', terms: invoice?.terms ?? '' });
  const [lines, setLines] = useState<LineDraft[]>(invoice ? invoice.lines.filter((l) => !l.changeOrderId).map((l) => ({ id: l.id, mode: l.percentBp != null ? 'percent' : 'amount', description: l.description, budgetLineId: l.budgetLineId, quantityThousandths: l.quantityThousandths, unitPriceCents: l.unitPriceCents, percentBp: l.percentBp ?? 0, taxable: l.taxable })) : [emptyLine()]);
  const [coIds, setCoIds] = useState<Set<string>>(new Set(invoice?.lines.filter((l) => l.changeOrderId).map((l) => l.changeOrderId!) ?? []));
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l));
  const save = useApiMutation(() => {
    const body = { ...form, dueDate: form.dueDate || null, lines: lines.map((l) => ({ id: l.id, description: l.description, budgetLineId: l.mode === 'percent' ? l.budgetLineId : null, quantityThousandths: l.mode === 'percent' ? 1000 : l.quantityThousandths, unitPriceCents: l.mode === 'percent' ? 0 : l.unitPriceCents, percentBp: l.mode === 'percent' ? l.percentBp : null, taxable: l.taxable })), changeOrderIds: [...coIds] };
    return invoice ? api.mutate<contracts.Invoice>('PATCH', `/v1/invoices/${invoice.id}`, body) : api.mutate<contracts.Invoice>('POST', `/v1/projects/${project.id}/invoices`, body);
  }, [...inv(project.id), ...(invoice ? [`/v1/invoices/${invoice.id}`] : [])]);
  const lineAmount = (l: LineDraft) => l.mode === 'percent' ? Math.round(((budget?.lines.find((b) => b.id === l.budgetLineId)?.originalSellCents ?? 0) * l.percentBp) / 10_000) : Math.round(l.unitPriceCents * l.quantityThousandths / 1000);
  const subtotal = lines.reduce((n, l) => n + lineAmount(l), 0) + (cos?.items ?? []).filter((c) => coIds.has(c.id)).reduce((n, c) => n + c.totalCents, 0);
  return <Sheet open onClose={onClose} title={invoice ? `Edit ${invoice.number}` : 'New invoice'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (lines.some((l) => !l.description.trim())) { toast({ message: 'Every line needs a description.', tone: 'error' }); return; } if (lines.some((l) => l.mode === 'percent' && !l.budgetLineId)) { toast({ message: 'Pick a budget line for percentage lines.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: invoice ? 'Invoice updated.' : 'Invoice created as a draft.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{invoice ? 'Save' : 'Create draft'}</Button></>}>
    <div className="form-grid">
      <Field label="Title" className="full"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="Progress draw 2" /></Field>
      <Field label="Billing type"><Select value={form.billingType} onChange={(e) => setForm({ ...form, billingType: e.target.value as any })}>{contracts.BILLING_TYPES.map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</Select></Field>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Field label="Issue date"><Input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /></Field><Field label="Due date" hint="Blank = 30 days"><Input type="date" value={form.dueDate ?? ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field></div>
      <Field label="Tax % (taxable lines)"><PercentInput value={form.taxBp} onChange={(v) => setForm({ ...form, taxBp: v })} aria-label="Tax percent" /></Field>
      <Field label="Retainage %"><PercentInput value={form.retainageBp} onChange={(v) => setForm({ ...form, retainageBp: v })} aria-label="Retainage percent" /></Field>
    </div>
    <h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Lines</h3>
    <div className="line-editor">
      {lines.map((l, i) => <div key={l.id ?? i} className="line" data-testid="invoice-line-editor">
        <div className="row"><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" aria-label="Line description" className="grow" /><Segmented value={l.mode} onChange={(m) => setLine(i, { mode: m })} ariaLabel="Line type" options={[{ value: 'amount', label: 'Amount' }, { value: 'percent', label: '% of budget' }]} /><Button variant="quiet" icon="trash" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} /></div>
        <div className="fields">
          {l.mode === 'percent' ? <>
            <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Budget line</span><BudgetLineSelect value={l.budgetLineId} onChange={(id) => setLine(i, { budgetLineId: id })} lines={budget?.lines} /></label>
            <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Percent complete</span><PercentInput value={l.percentBp} onChange={(v) => setLine(i, { percentBp: v })} aria-label="Percent of budget line" /></label>
          </> : <>
            <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Quantity</span><QuantityInput value={l.quantityThousandths} onChange={(v) => setLine(i, { quantityThousandths: v })} aria-label="Quantity" /></label>
            <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Unit price</span><MoneyInput value={l.unitPriceCents} onChange={(v) => setLine(i, { unitPriceCents: v })} aria-label="Unit price" /></label>
          </>}
          <div className="row-between" style={{ alignSelf: 'end' }}><Switch label="Taxable" checked={l.taxable} onChange={(v) => setLine(i, { taxable: v })} /><strong className="mono">{money(lineAmount(l))}</strong></div>
        </div>
      </div>)}
      <div><Button icon="plus" onClick={() => setLines([...lines, emptyLine()])}>Add line</Button></div>
    </div>
    {cos && cos.items.length > 0 && <Field label="Include approved change orders" className="mt-4"><div className="stack-sm">{cos.items.map((c) => { const taken = c.invoiceId && c.invoiceId !== invoice?.id; return <label key={c.id} className="row" style={{ minHeight: 40, opacity: taken ? 0.5 : 1 }}><input type="checkbox" disabled={!!taken} checked={coIds.has(c.id)} onChange={(e) => { const s = new Set(coIds); if (e.target.checked) s.add(c.id); else s.delete(c.id); setCoIds(s); }} /><span className="grow">#{c.number} {c.title}{taken ? ' (already invoiced)' : ''}</span><Money cents={c.totalCents} /></label>; })}</div></Field>}
    <div className="form-grid mt-4">
      <Field label="Notes to client"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <Field label="Terms"><Textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></Field>
    </div>
    <p className="subtle mt-2">Subtotal {money(subtotal)} before tax and retainage.</p>
  </Sheet>;
}

export function PaymentSheet({ path, max, keys, onClose, onSaved, direction = 'in' }: { path: string; max: number; keys: string[]; onClose: () => void; onSaved: () => void; direction?: 'in' | 'out' }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ amountCents: max, method: 'check', reference: '', notes: '' });
  const save = useApiMutation(() => api.mutate('POST', path, { ...form, reference: form.reference || null }), keys);
  return <Sheet open onClose={onClose} title={direction === 'in' ? 'Record payment' : 'Pay bill'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (form.amountCents <= 0) { toast({ message: 'Enter an amount.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); toast({ message: 'Payment recorded.', tone: 'success' }); onClose(); onSaved(); } catch (e) { errorToast(e); } }}>Record {money(form.amountCents)}</Button></>}>
    <div className="form-grid">
      <Field label="Amount" hint={`Outstanding ${money(max)}`}><MoneyInput value={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} aria-label="Amount" autoFocus /></Field>
      <Field label="Method"><Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{['check', 'ach', 'card', 'cash', 'other'].map((m) => <option key={m} value={m}>{m.toUpperCase() === 'ACH' ? 'ACH' : humanize(m)}</option>)}</Select></Field>
      <Field label="Reference / check number"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
      <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>
  </Sheet>;
}
