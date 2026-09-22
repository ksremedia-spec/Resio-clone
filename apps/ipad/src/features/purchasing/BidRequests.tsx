import { useState } from 'react';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Select, Sheet, Skeleton, StatusBadge, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { CostCodeSelect, Money, MoneyInput, useCostCodes } from '../financial/shared';

const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/bid-requests', '/v1/purchase-orders', '/v1/portal'];

/** Bid requests tab inside Purchasing: invite vendors, collect bids, award. */
export function BidRequests({ project, selectedId, onSelect, creating, onCloseCreate }: { project: contracts.ProjectDetail; selectedId: string | null; onSelect: (id: string | null) => void; creating: boolean; onCloseCreate: () => void }) {
  const session = useSession();
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.BidRequest[] }>(`/v1/projects/${project.id}/bid-requests?status=all&limit=100`);
  const items = data?.items ?? [];
  const canWrite = session.has('purchasing.write');
  return <>
    {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
    {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
    {data && items.length === 0 && <EmptyState icon="vendors" title="No bid requests" action={canWrite ? <Button variant="primary" onClick={() => onSelect('new')}>Request bids</Button> : undefined}>Send a scope to several vendors, compare their prices side by side and award the work as a purchase order.</EmptyState>}
    {items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((r) => <button key={r.id} className="list-row" data-testid="bid-request-row" onClick={() => onSelect(r.id)}>
      <span className="grow"><div className="primary">{r.title}</div><div className="secondary">{r.bids.length} vendor{r.bids.length === 1 ? '' : 's'} invited · {r.submittedCount} bid{r.submittedCount === 1 ? '' : 's'} in{r.dueDate ? ` · due ${dateShort(r.dueDate)}` : ''}{r.costCode ? ` · ${r.costCode}` : ''}</div></span>
      <span className="trailing">{r.lowestCents != null && <span className="subtle">low {money(r.lowestCents)}</span>}<StatusBadge status={r.status} /><Icon name="chevronRight" size={16} /></span>
    </button>)}</div></div>}
    {creating && <BidRequestSheet project={project} onClose={onCloseCreate} onSaved={(r) => onSelect(r.id)} />}
    {selectedId && selectedId !== 'new' && <BidRequestDetail project={project} id={selectedId} onClose={() => onSelect(null)} />}
  </>;
}

function BidRequestDetail({ project, id, onClose }: { project: contracts.ProjectDetail; id: string; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: r, refetch } = useResource<contracts.BidRequest>(`/v1/bid-requests/${id}`);
  const [editing, setEditing] = useState(false);
  const [keying, setKeying] = useState<contracts.Bid | null>(null);
  const [awarding, setAwarding] = useState<contracts.Bid | null>(null);
  const keys = [...inv(project.id), `/v1/bid-requests/${id}`];
  const act = useApiMutation((path: string) => api.mutate('POST', `/v1/bid-requests/${id}/${path}`, {}), keys);
  const award = useApiMutation((bidId: string) => api.mutate('POST', `/v1/bid-requests/${id}/award`, { bidId, createPurchaseOrder: true }), keys);
  if (!r) return <Sheet open onClose={onClose} title="Bid request"><Skeleton lines={5} /></Sheet>;
  const canWrite = session.has('purchasing.write');
  return <Sheet open onClose={onClose} title={r.title} size="lg" footer={<>
    {canWrite && r.status === 'open' && <Button variant="danger" onClick={() => act.mutateAsync('close').then(() => void refetch()).catch(errorToast)}>Close without awarding</Button>}
    <span className="grow" />
    {canWrite && r.status === 'draft' && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && r.status === 'draft' && <Button variant="primary" icon="send" onClick={() => act.mutateAsync('send').then(() => { toast({ message: 'Sent to the invited vendors.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Send to vendors</Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={r.status} />{r.costCode && <Badge>{r.costCode}</Badge>}{r.dueDate && <Badge tone={r.dueDate < new Date().toISOString().slice(0, 10) && r.status === 'open' ? 'danger' : 'neutral'}>due {dateShort(r.dueDate)}</Badge>}</div>
    {r.scope && <p className="muted mb-4" style={{ whiteSpace: 'pre-wrap' }}>{r.scope}</p>}
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Vendor</th><th>Status</th><th className="num">Bid</th><th>Notes</th><th /></tr></thead>
      <tbody>{r.bids.map((b) => <tr key={b.id} data-testid="bid-row" className={b.status === 'awarded' ? 'subtotal' : ''}>
        <td className="name"><div className="primary">{b.vendorName}</div><div className="secondary">{b.vendorTrade ?? ''}{b.submittedAt ? ` · ${dateTime(b.submittedAt)}` : ''}{b.validUntil ? ` · valid until ${dateShort(b.validUntil)}` : ''}</div></td>
        <td><StatusBadge status={b.status} /></td>
        <td className="num">{b.amountCents != null ? <strong className="mono" style={{ color: r.lowestCents === b.amountCents ? 'var(--success)' : undefined }}>{money(b.amountCents)}</strong> : <span className="muted">—</span>}</td>
        <td className="muted" style={{ maxWidth: 280 }}>{b.notes}</td>
        <td>{canWrite && r.status === 'open' && <span className="row">{['invited', 'submitted'].includes(b.status) && <Button size="sm" onClick={() => setKeying(b)}>{b.status === 'submitted' ? 'Edit bid' : 'Enter bid'}</Button>}{b.status === 'submitted' && <Button size="sm" variant="primary" onClick={() => setAwarding(b)}>Award</Button>}</span>}</td>
      </tr>)}</tbody>
    </table></div>
    {r.status === 'awarded' && <p className="subtle mt-4"><Icon name="checkCircle" size={14} /> Awarded. A draft purchase order was created on the Purchase orders tab.</p>}
    {editing && <BidRequestSheet project={project} request={r} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    {keying && <KeyBidSheet requestId={id} bid={keying} keys={keys} onClose={() => setKeying(null)} onSaved={() => void refetch()} />}
    <ConfirmDialog open={!!awarding} onClose={() => setAwarding(null)} title={`Award to ${awarding?.vendorName}?`} confirmLabel="Award and create PO" message={`${awarding?.vendorName} bid ${money(awarding?.amountCents ?? 0)}. The other vendors are marked not selected and a draft purchase order for this amount is created for you to approve and issue.`} onConfirm={async () => { try { await award.mutateAsync(awarding!.id); toast({ message: 'Awarded. Draft purchase order created.', tone: 'success' }); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

function KeyBidSheet({ requestId, bid, keys, onClose, onSaved }: { requestId: string; bid: contracts.Bid; keys: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ amountCents: bid.amountCents ?? 0, notes: bid.notes, validUntil: bid.validUntil ?? '' });
  const save = useApiMutation(() => api.mutate('POST', `/v1/bid-requests/${requestId}/bids`, { vendorId: bid.vendorId, amountCents: form.amountCents, notes: form.notes, validUntil: form.validUntil || null }), keys);
  return <Sheet open onClose={onClose} title={`Bid from ${bid.vendorName}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (form.amountCents <= 0) { toast({ message: 'Enter the bid amount.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); toast({ message: 'Bid recorded.', tone: 'success' }); onClose(); onSaved(); } catch (e) { errorToast(e); } }}>Save bid</Button></>}>
    <p className="subtle mb-4">Use this for bids that arrived by email or phone. Vendors with portal access submit their own.</p>
    <div className="form-grid">
      <Field label="Amount"><MoneyInput value={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} aria-label="Bid amount" autoFocus /></Field>
      <Field label="Valid until"><Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></Field>
      <Field label="Notes" className="full"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>
  </Sheet>;
}

function BidRequestSheet({ project, request, onClose, onSaved }: { project: contracts.ProjectDetail; request?: contracts.BidRequest; onClose: () => void; onSaved: (r: contracts.BidRequest) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: codes } = useCostCodes();
  const { data: vendors } = useResource<{ items: contracts.Vendor[] }>('/v1/vendors?limit=200');
  const [form, setForm] = useState({ title: request?.title ?? '', scope: request?.scope ?? '', costCodeId: request?.costCodeId ?? null, dueDate: request?.dueDate ?? '', vendorIds: new Set(request?.bids.map((b) => b.vendorId) ?? []) });
  const [trade, setTrade] = useState('');
  const save = useApiMutation(() => { const body = { title: form.title, scope: form.scope, costCodeId: form.costCodeId, dueDate: form.dueDate || null, vendorIds: [...form.vendorIds] }; return request ? api.mutate<contracts.BidRequest>('PATCH', `/v1/bid-requests/${request.id}`, body) : api.mutate<contracts.BidRequest>('POST', `/v1/projects/${project.id}/bid-requests`, body); }, [...inv(project.id), ...(request ? [`/v1/bid-requests/${request.id}`] : [])]);
  const trades = [...new Set((vendors?.items ?? []).map((v) => v.trade).filter(Boolean))] as string[];
  const shown = (vendors?.items ?? []).filter((v) => !trade || v.trade === trade);
  return <Sheet open onClose={onClose} title={request ? 'Edit bid request' : 'Request bids'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.title.trim()) { toast({ message: 'Give the request a title.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: request ? 'Bid request updated.' : 'Bid request created. Send it when the scope is ready.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{request ? 'Save' : 'Create'}</Button></>}>
    <div className="form-grid">
      <Field label="Title" className="full"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus placeholder="Plumbing rough-in" /></Field>
      <Field label="Cost code"><CostCodeSelect value={form.costCodeId} onChange={(id) => setForm({ ...form, costCodeId: id })} codes={codes} /></Field>
      <Field label="Bids due"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      <Field label="Scope of work" className="full"><Textarea value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="What is included, what is excluded, drawings to reference, site conditions…" style={{ minHeight: 120 }} /></Field>
      <Field label="Invite vendors" className="full" hint={`${form.vendorIds.size} selected`}>
        <div className="row wrap mb-2"><Select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Filter by trade" style={{ maxWidth: 220 }}><option value="">All trades</option>{trades.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
        <div className="row wrap">{shown.map((v) => <button key={v.id} type="button" className={`chip ${form.vendorIds.has(v.id) ? 'on' : ''}`} aria-pressed={form.vendorIds.has(v.id)} data-testid="vendor-chip" onClick={() => { const s = new Set(form.vendorIds); if (s.has(v.id)) s.delete(v.id); else s.add(v.id); setForm({ ...form, vendorIds: s }); }}>{v.name}{v.trade ? <span className="subtle"> · {v.trade}</span> : null}</button>)}</div>
      </Field>
    </div>
    <p className="subtle mt-2"><Icon name="info" size={14} /> Invited vendors get an email and, if they have portal access, see the request when they sign in. They never see each other's bids.</p>
  </Sheet>;
}

export { Money };
