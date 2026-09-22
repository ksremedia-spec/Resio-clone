import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, Sheet, Skeleton, StatusBadge, Textarea, Toolbar, useErrorToast, useToast } from '../../ui/components';
import { dateShort, money, timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';
import { MoneyInput } from '../financial/shared';

/** The subcontractor's front door: bid requests to answer, purchase orders to acknowledge, tasks on the schedule. */
export default function VendorHome() {
  const navigate = useNavigate();
  const session = useSession();
  const { bidRequestId } = useParams();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data, isLoading, error, refetch } = useResource<contracts.VendorOverview>('/v1/portal/vendor/overview');
  const ack = useApiMutation((id: string) => api.mutate('POST', `/v1/purchase-orders/${id}/acknowledge`, {}), ['/v1/portal']);
  const first = session.user?.firstName ?? '';
  return <>
    <Toolbar title={<span>{session.membership?.organization.name}</span>} leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-5)' }}>
      <div><h1 style={{ fontSize: 'var(--fs-2xl)' }}>Hi {first}</h1><div className="muted">{data?.vendor ? `${data.vendor.name}${data.vendor.trade ? ` · ${data.vendor.trade}` : ''} · ` : ''}Bid requests, purchase orders and your scheduled work with {session.membership?.organization.name}.</div></div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <Skeleton lines={5} />}
      {data && !data.vendor && <EmptyState icon="vendors" title="Your account is not linked to a vendor yet">Ask the builder to invite you with the same email address as your vendor record.</EmptyState>}
      {data && data.bidRequests.length > 0 && <Card title={<span className="row" style={{ gap: 8 }}>Bid requests <Badge tone="count">{data.bidRequests.filter((b) => b.status === 'open' && b.myBid?.status === 'invited').length}</Badge></span>}>
        <div className="list">{data.bidRequests.map((b) => <button key={b.id} className="list-row" style={{ borderRadius: 8 }} data-testid="vendor-bid" onClick={() => navigate(`/bids/${b.id}`)}>
          <Icon name="file" />
          <span className="grow"><div className="primary">{b.title}</div><div className="secondary">{b.projectName}{b.dueDate ? ` · bids due ${dateShort(b.dueDate)}` : ''}</div></span>
          <span className="trailing">{b.myBid?.amountCents != null && <span className="mono">{money(b.myBid.amountCents)}</span>}<StatusBadge status={b.status === 'open' ? (b.myBid?.status ?? 'invited') : b.myBid?.status === 'awarded' ? 'awarded' : b.status} /><Icon name="chevronRight" size={16} /></span>
        </button>)}</div>
      </Card>}
      {data && data.purchaseOrders.length > 0 && <Card title="Purchase orders">
        <div className="list">{data.purchaseOrders.map((po) => <div key={po.id} className="list-row" style={{ borderRadius: 8 }} data-testid="vendor-po">
          <Icon name="invoices" />
          <span className="grow"><div className="primary">{po.number} · {po.title}</div><div className="secondary">{po.projectName}{po.issuedAt ? ` · issued ${dateShort(po.issuedAt)}` : ''}{po.acknowledgedAt ? ` · acknowledged ${timeAgo(po.acknowledgedAt)}` : ''}</div></span>
          <span className="trailing"><span className="mono">{money(po.totalCents)}</span><StatusBadge status={po.status} />{!po.acknowledgedAt && po.status !== 'closed' && <Button size="sm" variant="primary" loading={ack.isPending} onClick={() => ack.mutateAsync(po.id).then(() => { toast({ message: 'Acknowledged. The builder has been told.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Acknowledge</Button>}<Button size="sm" variant="quiet" onClick={() => navigate(`/projects/${po.projectId}/purchasing?po=${po.id}`)}>Open</Button></span>
        </div>)}</div>
      </Card>}
      {data && data.tasks.length > 0 && <Card title="Your scheduled work">
        <div className="list">{data.tasks.map((t) => <button key={t.id} className="list-row" style={{ borderRadius: 8 }} onClick={() => navigate(`/projects/${t.projectId}/tasks/${t.id}`)}><Icon name="tasks" /><span className="grow"><div className="primary">{t.name}</div><div className="secondary">{t.projectName} · {dateShort(t.startDate)} → {dateShort(t.endDate)}</div></span><span className="trailing"><StatusBadge status={t.status} /><Icon name="chevronRight" size={16} /></span></button>)}</div>
      </Card>}
      {data && data.projects.length > 0 && <Card title="Projects shared with you">
        <div className="list">{data.projects.map((p) => <button key={p.id} className="list-row" style={{ borderRadius: 8 }} onClick={() => navigate(`/projects/${p.id}`)}><Icon name="projects" /><span className="grow"><div className="primary">{p.number} · {p.name}</div><div className="secondary">{p.addressLine}</div></span><Icon name="chevronRight" size={16} /></button>)}</div>
      </Card>}
      {bidRequestId && <BidRequestSheet id={bidRequestId} onClose={() => { navigate('/'); void refetch(); }} />}
    </div></div>
  </>;
}

/** A vendor reads the scope and submits (or revises) their price. */
function BidRequestSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: r, refetch } = useResource<contracts.BidRequest>(`/v1/bid-requests/${id}`);
  const mine = r?.bids[0];
  const [form, setForm] = useState({ amountCents: 0, notes: '', validUntil: '' });
  const [ready, setReady] = useState(false);
  if (r && !ready) { setForm({ amountCents: mine?.amountCents ?? 0, notes: mine?.notes ?? '', validUntil: mine?.validUntil ?? '' }); setReady(true); }
  const submit = useApiMutation(() => api.mutate('POST', `/v1/bid-requests/${id}/bids`, { amountCents: form.amountCents, notes: form.notes, validUntil: form.validUntil || null }), ['/v1/bid-requests', '/v1/portal']);
  const decline = useApiMutation(() => api.mutate('POST', `/v1/bid-requests/${id}/decline`, {}), ['/v1/bid-requests', '/v1/portal']);
  if (!r) return <Sheet open onClose={onClose} title="Bid request"><Skeleton lines={5} /></Sheet>;
  const open = r.status === 'open' && mine && ['invited', 'submitted'].includes(mine.status);
  return <Sheet open onClose={onClose} title={r.title} size="lg" footer={<>{open && <Button onClick={() => decline.mutateAsync(undefined).then(() => { toast({ message: 'Declined.' }); onClose(); }).catch(errorToast)}>Decline to bid</Button>}<span className="grow" /><Button onClick={onClose}>Close</Button>{open && <Button variant="primary" icon="send" loading={submit.isPending} data-testid="submit-bid" onClick={async () => { if (form.amountCents <= 0) { toast({ message: 'Enter your price.', tone: 'error' }); return; } try { await submit.mutateAsync(undefined); toast({ message: mine?.status === 'submitted' ? 'Bid updated.' : 'Bid submitted. Good luck!', tone: 'success' }); void refetch(); } catch (e) { errorToast(e); } }}>{mine?.status === 'submitted' ? 'Update bid' : 'Submit bid'}</Button>}</>}>
    <div className="row wrap mb-2"><StatusBadge status={r.status} />{mine && <StatusBadge status={mine.status} />}<span className="subtle">{r.projectName}{r.dueDate ? ` · bids due ${dateShort(r.dueDate)}` : ''}{r.costCode ? ` · ${r.costCode}` : ''}</span></div>
    <Field label="Scope of work"><p style={{ whiteSpace: 'pre-wrap' }}>{r.scope || 'See attached plans.'}</p></Field>
    {r.attachments && r.attachments.length > 0 && <Field label="Attachments"><div className="stack-sm">{r.attachments.map((d) => <a key={d.id} href={d.downloadUrl} target="_blank" rel="noreferrer"><Icon name="file" size={14} /> {d.name}</a>)}</div></Field>}
    {mine?.status === 'awarded' && <div className="banner syncing mb-4" style={{ borderRadius: 8 }}><Icon name="checkCircle" size={16} />You were awarded this work. A purchase order will follow.</div>}
    {mine?.status === 'not_selected' && <div className="banner offline mb-4" style={{ borderRadius: 8 }}>This request was awarded to another vendor.</div>}
    {open && <div className="form-grid">
      <Field label="Your price" className="full"><MoneyInput value={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} aria-label="Bid amount" /></Field>
      <Field label="Valid until"><Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></Field>
      <Field label="Notes, exclusions, lead time" className="full"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>}
  </Sheet>;
}
