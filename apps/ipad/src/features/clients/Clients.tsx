import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, ListRow, MenuButton, SearchField, Sheet, Skeleton, Textarea, Toolbar, useDebounced, useErrorToast, useIsCompact, useKeyboardShortcut, useToast } from '../../ui/components';
import { useSession } from '../../store/session';

export default function Clients() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Client[] }>(`/v1/clients?limit=200&status=${showArchived ? 'archived' : 'active'}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`);
  const creating = params.get('new') === '1';
  useKeyboardShortcut('mod+n', () => { if (session.has('clients.write')) setParams({ new: '1' }); });
  const list = (
    <div className="split-list">
      <div style={{ padding: 'var(--sp-3) var(--sp-4)' }} className="stack-sm">
        <SearchField value={q} onChange={setQ} placeholder="Search clients" />
        <label className="row subtle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
      </div>
      {error && !data && <div style={{ padding: 16 }}><ErrorState error={error} retry={() => void refetch()} /></div>}
      {isLoading && !data && <div style={{ padding: 16 }}><Skeleton lines={5} /></div>}
      {data?.items.length === 0 && <EmptyState icon="clients" title={debounced ? 'No matches' : 'No clients yet'} action={session.has('clients.write') ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Add client</Button> : undefined} />}
      <div className="list">{data?.items.map((c) => <ListRow key={c.id} selected={c.id === clientId} onClick={() => navigate(`/clients/${c.id}`)} leading={<Avatar name={c.displayName} />} primary={c.displayName} secondary={c.companyName || c.email || c.phone || ''} trailing={<>{!!c.projectCount && <Badge>{c.projectCount} project{c.projectCount === 1 ? '' : 's'}</Badge>}<Icon name="chevronRight" size={16} /></>} />)}</div>
    </div>
  );
  return <>
    <Toolbar title="Clients" leading={<>{compact && clientId ? <Button variant="quiet" icon="back" onClick={() => navigate('/clients')} aria-label="Back" /> : <MenuToggle />}</>}>
      {session.has('clients.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New client</Button>}
      <ToolbarActions />
    </Toolbar>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
      {(!compact || !clientId) && list}
      {(!compact || clientId) && <div className="split-detail">{clientId ? <ClientDetail clientId={clientId} onDeleted={() => navigate('/clients')} /> : <EmptyState icon="clients" title="Select a client">Client details, contacts and projects appear here.</EmptyState>}</div>}
    </div>
    {creating && <ClientFormSheet open onClose={() => setParams({})} onSaved={(c) => navigate(`/clients/${c.id}`)} />}
  </>;
}

function ClientDetail({ clientId, onDeleted }: { clientId: string; onDeleted: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: client, isLoading, error, refetch } = useResource<contracts.Client>(`/v1/clients/${clientId}`);
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>(`/v1/projects?clientId=${clientId}&status=all&limit=50`);
  const [editing, setEditing] = useState(false);
  const [contactSheet, setContactSheet] = useState<null | { contact?: contracts.Contact }>(null);
  const [archiving, setArchiving] = useState(false);
  const archive = useApiMutation((archived: boolean) => api.mutate('POST', `/v1/clients/${clientId}/archive`, { archived }), ['/v1/clients']);
  const removeContact = useApiMutation((id: string) => api.mutate('DELETE', `/v1/clients/${clientId}/contacts/${id}`), [`/v1/clients/${clientId}`]);
  if (error && !client) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  if (!client) return <div className="page-inner"><Skeleton lines={6} /></div>;
  const canEdit = session.has('clients.write');
  const addr = client.billingAddress;
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row-between">
        <div className="row" style={{ gap: 'var(--sp-3)' }}><Avatar name={client.displayName} /><div><h2>{client.displayName}</h2><div className="subtle">{client.companyName ?? ''}{client.status === 'archived' && <Badge tone="warning" className="mt-2" style={{ marginLeft: 8 } as any}>archived</Badge>}</div></div></div>
        {canEdit && <MenuButton items={[{ label: 'Edit client', icon: 'edit', onSelect: () => setEditing(true) }, { label: client.status === 'archived' ? 'Restore' : 'Archive', icon: 'trash', danger: client.status !== 'archived', onSelect: () => setArchiving(true) }]} />}
      </div>
      <div className="card-grid">
        <Card title="Contact">
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt className="muted">Email</dt><dd style={{ margin: 0 }}>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Phone</dt><dd style={{ margin: 0 }}>{client.phone ? <a href={`tel:${client.phone}`}>{client.phone}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Billing address</dt><dd style={{ margin: 0, textAlign: 'right' }}>{[addr.line1, addr.city, addr.region, addr.postalCode].filter(Boolean).join(', ') || '—'}</dd></div>
          </dl>
          {client.notes && <p className="muted mt-4" style={{ whiteSpace: 'pre-wrap' }}>{client.notes}</p>}
        </Card>
        <Card title="Contacts" actions={canEdit && <Button size="sm" icon="plus" onClick={() => setContactSheet({})}>Add</Button>}>
          {client.contacts?.length ? <div className="list">{client.contacts.map((c) => <div key={c.id} className="list-row" style={{ padding: '8px 0' }}><Avatar name={`${c.firstName} ${c.lastName}`} size="sm" /><span className="grow"><div className="primary">{c.firstName} {c.lastName} {c.isPrimary && <Badge tone="brand">primary</Badge>}</div><div className="secondary">{[c.title, c.email, c.phone].filter(Boolean).join(' · ')}</div></span>{canEdit && <span className="trailing"><Button size="sm" variant="quiet" icon="edit" aria-label="Edit contact" onClick={() => setContactSheet({ contact: c })} /><Button size="sm" variant="quiet" icon="trash" aria-label="Remove contact" onClick={() => removeContact.mutate(c.id)} /></span>}</div>)}</div> : <p className="muted">No contacts yet.</p>}
        </Card>
        <Card title="Projects" wide actions={session.has('projects.write') && <Button size="sm" icon="plus" onClick={() => navigate('/projects?new=1')}>New project</Button>}>
          {projects?.items.length ? <div className="list">{projects.items.map((p) => <button key={p.id} className="list-row" style={{ borderRadius: 8, borderBottom: 0 }} onClick={() => navigate(`/projects/${p.id}`)}><span className="dot" style={{ background: p.color }} /><span className="grow"><div className="primary">{p.number} · {p.name}</div><div className="secondary">{p.status.replace('_', ' ')}</div></span><Icon name="chevronRight" size={16} /></button>)}</div> : <p className="muted">No projects for this client yet.</p>}
        </Card>
      </div>
      {editing && <ClientFormSheet open onClose={() => setEditing(false)} client={client} onSaved={() => void refetch()} />}
      {contactSheet && <ContactSheet clientId={clientId} contact={contactSheet.contact} onClose={() => setContactSheet(null)} />}
      <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} danger={client.status !== 'archived'} title={client.status === 'archived' ? 'Restore client?' : 'Archive client?'} confirmLabel={client.status === 'archived' ? 'Restore' : 'Archive'} message="Archived clients stay attached to their projects and can be restored at any time." onConfirm={async () => { try { await archive.mutateAsync(client.status !== 'archived'); toast({ message: 'Done.', tone: 'success' }); void refetch(); if (client.status !== 'archived') onDeleted(); } catch (e) { errorToast(e); throw e; } }} />
    </div>
  );
}

export function ClientFormSheet({ open, onClose, client, onSaved }: { open: boolean; onClose: () => void; client?: contracts.Client; onSaved: (c: contracts.Client) => void }) {
  const [form, setForm] = useState({ displayName: client?.displayName ?? '', companyName: client?.companyName ?? '', email: client?.email ?? '', phone: client?.phone ?? '', line1: client?.billingAddress.line1 ?? '', city: client?.billingAddress.city ?? '', region: client?.billingAddress.region ?? '', postalCode: client?.billingAddress.postalCode ?? '', notes: client?.notes ?? '' });
  const toast = useToast();
  const errorToast = useErrorToast();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useApiMutation(() => {
    const body = { displayName: form.displayName.trim(), companyName: form.companyName.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null, billingAddress: { line1: form.line1, city: form.city, region: form.region, postalCode: form.postalCode }, notes: form.notes };
    return client ? api.mutate<contracts.Client>('PATCH', `/v1/clients/${client.id}`, body) : api.mutate<contracts.Client>('POST', '/v1/clients', body);
  }, ['/v1/clients']);
  return (
    <Sheet open={open} onClose={onClose} title={client ? 'Edit client' : 'New client'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.displayName.trim()) { toast({ message: 'Enter a name.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: client ? 'Client updated.' : 'Client created.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{client ? 'Save' : 'Create client'}</Button></>}>
      <div className="form-grid">
        <Field label="Name" className="full"><Input value={form.displayName} onChange={set('displayName')} autoFocus placeholder="Jane & John Smith" /></Field>
        <Field label="Company (optional)" className="full"><Input value={form.companyName} onChange={set('companyName')} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} autoCapitalize="none" /></Field>
        <Field label="Phone"><Input type="tel" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Billing address" className="full"><Input value={form.line1} onChange={set('line1')} placeholder="Street" /></Field>
        <Field label="City"><Input value={form.city} onChange={set('city')} /></Field>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Field label="State"><Input value={form.region} onChange={set('region')} /></Field><Field label="ZIP"><Input value={form.postalCode} onChange={set('postalCode')} /></Field></div>
        <Field label="Notes" className="full"><Textarea value={form.notes} onChange={set('notes')} /></Field>
      </div>
    </Sheet>
  );
}

function ContactSheet({ clientId, contact, onClose }: { clientId: string; contact?: contracts.Contact; onClose: () => void }) {
  const [form, setForm] = useState({ firstName: contact?.firstName ?? '', lastName: contact?.lastName ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '', title: contact?.title ?? '', isPrimary: contact?.isPrimary ?? false });
  const errorToast = useErrorToast();
  const save = useApiMutation(() => { const body = { ...form, email: form.email || null, phone: form.phone || null, title: form.title || null }; return contact ? api.mutate('PATCH', `/v1/clients/${clientId}/contacts/${contact.id}`, body) : api.mutate('POST', `/v1/clients/${clientId}/contacts`, body); }, [`/v1/clients/${clientId}`]);
  useEffect(() => { /* keep sheet mounted */ }, []);
  return (
    <Sheet open onClose={onClose} title={contact ? 'Edit contact' : 'Add contact'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { try { await save.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); } }}>Save</Button></>}>
      <div className="form-grid">
        <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} autoFocus /></Field>
        <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Role / title" className="full"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Homeowner, architect, designer…" /></Field>
        <label className="row full"><input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> Primary contact</label>
      </div>
    </Sheet>
  );
}
