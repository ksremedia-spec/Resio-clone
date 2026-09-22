import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, ListRow, MenuButton, SearchField, Sheet, Skeleton, StatusBadge, Textarea, Toolbar, useDebounced, useErrorToast, useIsCompact, useKeyboardShortcut, useToast } from '../../ui/components';
import { dateShort, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { Money } from '../financial/shared';

export default function Vendors() {
  const { vendorId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Vendor[] }>(`/v1/vendors?limit=200&includeArchived=${showArchived}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`);
  const creating = params.get('new') === '1';
  useKeyboardShortcut('mod+n', () => { if (session.has('vendors.write')) setParams({ new: '1' }); });
  const list = (
    <div className="split-list">
      <div style={{ padding: 'var(--sp-3) var(--sp-4)' }} className="stack-sm">
        <SearchField value={q} onChange={setQ} placeholder="Search vendors or trades" />
        <label className="row subtle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
      </div>
      {error && !data && <div style={{ padding: 16 }}><ErrorState error={error} retry={() => void refetch()} /></div>}
      {isLoading && !data && <div style={{ padding: 16 }}><Skeleton lines={5} /></div>}
      {data?.items.length === 0 && <EmptyState icon="vendors" title={debounced ? 'No matches' : 'No vendors yet'} action={session.has('vendors.write') ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Add vendor</Button> : undefined}>Subcontractors and suppliers you buy from.</EmptyState>}
      <div className="list">{data?.items.map((v) => <ListRow key={v.id} selected={v.id === vendorId} onClick={() => navigate(`/vendors/${v.id}`)} leading={<Avatar name={v.name} />} primary={v.name} secondary={[v.trade, v.email || v.phone].filter(Boolean).join(' · ')} trailing={<>{!!v.openPoCents && <Badge tone="brand">{money(v.openPoCents)} open</Badge>}<Icon name="chevronRight" size={16} /></>} data-testid="vendor-row" />)}</div>
    </div>
  );
  return <>
    <Toolbar title="Vendors" leading={<>{compact && vendorId ? <Button variant="quiet" icon="back" onClick={() => navigate('/vendors')} aria-label="Back" /> : <MenuToggle />}</>}>
      {session.has('vendors.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New vendor</Button>}
      <ToolbarActions />
    </Toolbar>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
      {(!compact || !vendorId) && list}
      {(!compact || vendorId) && <div className="split-detail">{vendorId ? <VendorDetail vendorId={vendorId} onArchived={() => navigate('/vendors')} /> : <EmptyState icon="vendors" title="Select a vendor">Contact details, open purchase orders and bills appear here.</EmptyState>}</div>}
    </div>
    {creating && <VendorFormSheet onClose={() => setParams({})} onSaved={(v) => navigate(`/vendors/${v.id}`)} />}
  </>;
}

function VendorDetail({ vendorId, onArchived }: { vendorId: string; onArchived: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: vendor, error, refetch } = useResource<contracts.Vendor>(`/v1/vendors/${vendorId}`);
  const { data: pos } = useResource<{ items: contracts.PurchaseOrder[] }>(session.has('purchasing.read') ? `/v1/purchase-orders?vendorId=${vendorId}&status=all&limit=50` : null);
  const { data: bills } = useResource<{ items: contracts.Bill[] }>(session.has('bills.read') ? `/v1/bills?vendorId=${vendorId}&status=all&limit=50` : null);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archive = useApiMutation((archived: boolean) => api.mutate('POST', `/v1/vendors/${vendorId}/archive`, { archived }), ['/v1/vendors']);
  if (error && !vendor) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  if (!vendor) return <div className="page-inner"><Skeleton lines={6} /></div>;
  const canEdit = session.has('vendors.write');
  const archived = vendor.status === 'archived';
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row-between">
        <div className="row" style={{ gap: 'var(--sp-3)' }}><Avatar name={vendor.name} /><div><h2>{vendor.name}</h2><div className="subtle">{vendor.trade ?? 'No trade set'}{archived && <Badge tone="warning" style={{ marginLeft: 8 }}>archived</Badge>}</div></div></div>
        {canEdit && <MenuButton items={[{ label: 'Edit vendor', icon: 'edit', onSelect: () => setEditing(true) }, { label: archived ? 'Restore' : 'Archive', icon: 'trash', danger: !archived, onSelect: () => setArchiving(true) }]} />}
      </div>
      <div className="card-grid">
        <Card title="Contact">
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt className="muted">Email</dt><dd style={{ margin: 0 }}>{vendor.email ? <a href={`mailto:${vendor.email}`}>{vendor.email}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Phone</dt><dd style={{ margin: 0 }}>{vendor.phone ? <a href={`tel:${vendor.phone}`}>{vendor.phone}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Website</dt><dd style={{ margin: 0 }}>{vendor.website ?? '—'}</dd></div>
            <div className="row-between"><dt className="muted">Open purchase orders</dt><dd style={{ margin: 0 }}><Money cents={vendor.openPoCents ?? 0} /></dd></div>
          </dl>
          {vendor.notes && <p className="muted mt-4" style={{ whiteSpace: 'pre-wrap' }}>{vendor.notes}</p>}
        </Card>
        <Card title="Purchase orders">
          {pos?.items.length ? <div className="list">{pos.items.map((po) => <button key={po.id} className="list-row" style={{ borderRadius: 8, borderBottom: 0 }} onClick={() => navigate(`/projects/${po.projectId}/purchasing?po=${po.id}`)}><span className="grow"><div className="primary">{po.number} · {po.title}</div><div className="secondary">{po.projectName}</div></span><span className="trailing"><Money cents={po.totalCents} /><StatusBadge status={po.status} /></span></button>)}</div> : <p className="muted">No purchase orders yet.</p>}
        </Card>
        <Card title="Bills" wide>
          {bills?.items.length ? <div className="list">{bills.items.map((b) => <button key={b.id} className="list-row" style={{ borderRadius: 8, borderBottom: 0 }} onClick={() => b.projectId && navigate(`/projects/${b.projectId}/purchasing?tab=bills&bill=${b.id}`)}><span className="grow"><div className="primary">{b.number}{b.vendorReference ? ` · ${b.vendorReference}` : ''}</div><div className="secondary">{b.projectName ?? 'No project'} · due {dateShort(b.dueDate)}</div></span><span className="trailing"><Money cents={b.totalCents} /><StatusBadge status={b.status} /></span></button>)}</div> : <p className="muted">No bills yet.</p>}
        </Card>
      </div>
      {editing && <VendorFormSheet vendor={vendor} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
      <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} danger={!archived} title={archived ? 'Restore vendor?' : 'Archive vendor?'} confirmLabel={archived ? 'Restore' : 'Archive'} message="Archived vendors keep their purchase orders and bills and can be restored later." onConfirm={async () => { try { await archive.mutateAsync(!archived); toast({ message: 'Done.', tone: 'success' }); void refetch(); if (!archived) onArchived(); } catch (e) { errorToast(e); throw e; } }} />
    </div>
  );
}

function VendorFormSheet({ vendor, onClose, onSaved }: { vendor?: contracts.Vendor; onClose: () => void; onSaved: (v: contracts.Vendor) => void }) {
  const [form, setForm] = useState({ name: vendor?.name ?? '', trade: vendor?.trade ?? '', email: vendor?.email ?? '', phone: vendor?.phone ?? '', website: vendor?.website ?? '', notes: vendor?.notes ?? '' });
  const toast = useToast();
  const errorToast = useErrorToast();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useApiMutation(() => { const body = { name: form.name.trim(), trade: form.trade.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, website: form.website.trim() || null, notes: form.notes }; return vendor ? api.mutate<contracts.Vendor>('PATCH', `/v1/vendors/${vendor.id}`, body) : api.mutate<contracts.Vendor>('POST', '/v1/vendors', body); }, ['/v1/vendors']);
  return (
    <Sheet open onClose={onClose} title={vendor ? 'Edit vendor' : 'New vendor'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim()) { toast({ message: 'Enter a name.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: vendor ? 'Vendor updated.' : 'Vendor created.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{vendor ? 'Save' : 'Create vendor'}</Button></>}>
      <div className="form-grid">
        <Field label="Name" className="full"><Input value={form.name} onChange={set('name')} autoFocus placeholder="Hill Country Cabinets" /></Field>
        <Field label="Trade"><Input value={form.trade} onChange={set('trade')} placeholder="Cabinetry" /></Field>
        <Field label="Website"><Input value={form.website} onChange={set('website')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} autoCapitalize="none" /></Field>
        <Field label="Phone"><Input type="tel" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Notes" className="full"><Textarea value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Sheet>
  );
}
