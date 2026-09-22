import { useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { contracts, PERMISSIONS } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Select, Sheet, Skeleton, Switch, Textarea, Toolbar, useErrorToast, useIsCompact, useToast } from '../../ui/components';
import { useSession } from '../../store/session';
import { dateShort, timeAgo } from '../../ui/format';

export default function Settings() {
  const session = useSession();
  const compact = useIsCompact();
  const sections = [
    { to: 'profile', label: 'Profile & security' },
    { to: 'notifications', label: 'Notifications' },
    ...(session.has('org.manage') ? [{ to: 'company', label: 'Company' }] : []),
    ...(session.has('members.invite') || session.has('members.manage') ? [{ to: 'members', label: 'Members & invitations' }] : []),
    ...(session.has('roles.manage') ? [{ to: 'roles', label: 'Roles & permissions' }] : []),
    ...(session.has('ai.use') ? [{ to: 'ai', label: 'AI assistant' }] : []),
  ];
  return <>
    <Toolbar title="Settings" leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
      <div className="split-list" style={compact ? { borderRight: 0, flex: 'none' } : undefined}>
        <nav className="list" style={compact ? { flexDirection: 'row', overflowX: 'auto' } : undefined} aria-label="Settings sections">{sections.map((s) => <NavLink key={s.to} to={`/settings/${s.to}`} className={({ isActive }) => `list-row ${isActive ? 'selected' : ''}`} style={compact ? { minWidth: 180, borderBottom: 0 } : undefined}><span className="primary">{s.label}</span></NavLink>)}</nav>
      </div>
      <div className="split-detail"><div className="page-inner">
        <Routes>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSettings />} />
          <Route path="notifications" element={<NotificationSettings />} />
          <Route path="company" element={<CompanySettings />} />
          <Route path="members" element={<MembersSettings />} />
          <Route path="roles" element={<RolesSettings />} />
          <Route path="ai" element={<AiSettings />} />
        </Routes>
      </div></div>
    </div>
  </>;
}

function ProfileSettings() {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ firstName: session.user?.firstName ?? '', lastName: session.user?.lastName ?? '', phone: session.user?.phone ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const { data: sessions, refetch } = useResource<Array<{ id: string; deviceName: string | null; userAgent: string | null; lastSeenAt: string; current: boolean }>>('/v1/auth/sessions');
  const save = async (e: FormEvent) => { e.preventDefault(); try { await api.mutate('PATCH', '/v1/auth/profile', { ...form, phone: form.phone || null }); await session.refresh(); toast({ message: 'Profile saved.', tone: 'success' }); } catch (err) { errorToast(err); } };
  const changePw = async (e: FormEvent) => { e.preventDefault(); try { await api.mutate('POST', '/v1/auth/password/change', pw); setPw({ currentPassword: '', newPassword: '' }); toast({ message: 'Password changed. Other devices were signed out.', tone: 'success' }); void refetch(); } catch (err) { errorToast(err); } };
  return (
    <div className="stack" style={{ gap: 'var(--sp-4)', maxWidth: 720 }}>
      <Card title="Profile">
        <form onSubmit={save} className="form-grid">
          <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          <Field label="Email" className="full" hint={session.user?.emailVerifiedAt ? 'Verified' : 'Not verified yet — check your inbox.'}><Input value={session.user?.email ?? ''} disabled /></Field>
          <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="full row" style={{ justifyContent: 'flex-end' }}>{!session.user?.emailVerifiedAt && <Button onClick={async () => { try { await api.mutate('POST', '/v1/auth/email/resend'); toast({ message: 'Verification email sent.' }); } catch (e) { errorToast(e); } }}>Resend verification</Button>}<Button type="submit" variant="primary">Save profile</Button></div>
        </form>
      </Card>
      <Card title="Change password">
        <form onSubmit={changePw} className="form-grid">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
          <Field label="New password" hint="At least 10 characters."><Input type="password" autoComplete="new-password" minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></Field>
          <div className="full row" style={{ justifyContent: 'flex-end' }}><Button type="submit" variant="primary">Change password</Button></div>
        </form>
      </Card>
      <Card title="Signed-in devices" actions={<Button size="sm" variant="quiet" onClick={async () => { await api.mutate('POST', '/v1/auth/logout-all'); void session.signOut(); }}>Sign out everywhere</Button>}>
        {!sessions ? <Skeleton /> : <div className="list">{sessions.map((s) => <div key={s.id} className="list-row" style={{ padding: '8px 0' }}><span className="grow"><div className="primary">{s.deviceName ?? 'Device'} {s.current && <Badge tone="brand">this device</Badge>}</div><div className="secondary truncate">{s.userAgent ?? ''} · active {timeAgo(s.lastSeenAt)}</div></span>{!s.current && <Button size="sm" onClick={async () => { await api.mutate('DELETE', `/v1/auth/sessions/${s.id}`); void refetch(); }}>Revoke</Button>}</div>)}</div>}
      </Card>
    </div>
  );
}

function NotificationSettings() {
  const { data, refetch } = useResource<contracts.NotificationPreferences>('/v1/notification-preferences');
  const toast = useToast();
  const save = useApiMutation((prefs: contracts.NotificationPreferences) => api.mutate('PUT', '/v1/notification-preferences', prefs), ['/v1/notification-preferences']);
  if (!data) return <Skeleton lines={6} />;
  const toggle = (kind: string, channel: string) => {
    const prefs = data.preferences.map((p) => p.kind === kind ? { ...p, channels: p.channels.includes(channel as any) ? p.channels.filter((c) => c !== channel) : [...p.channels, channel as any] } : p);
    void save.mutateAsync({ preferences: prefs }).then(() => { void refetch(); toast({ message: 'Preferences saved.' }); });
  };
  return (
    <Card title="Notification preferences">
      <p className="muted mb-4">Choose how you want to hear about each kind of event. In-app notifications are always on.</p>
      <table className="table"><thead><tr><th>Event</th><th>Push</th><th>Email</th><th>SMS</th></tr></thead><tbody>
        {data.preferences.map((p) => <tr key={p.kind}><td>{p.kind.replace(/[._]/g, ' ')}</td>{(['push', 'email', 'sms'] as const).map((c) => <td key={c}><input type="checkbox" aria-label={`${p.kind} via ${c}`} checked={p.channels.includes(c)} onChange={() => toggle(p.kind, c)} /></td>)}</tr>)}
      </tbody></table>
    </Card>
  );
}

function CompanySettings() {
  const { data, refetch } = useResource<contracts.OrganizationDetail>('/v1/organization');
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const f = form ?? (data ? { name: data.name, legalName: data.legalName ?? '', email: data.email ?? '', phone: data.phone ?? '', website: data.website ?? '', line1: data.address.line1, city: data.address.city, region: data.address.region, postalCode: data.address.postalCode, timezone: data.timezone, currency: data.currency, defaultMarkup: (data.defaultMarkupBp / 100).toString(), defaultTax: (data.defaultTaxBp / 100).toString(), workingDays: data.workingDays } : null);
  if (!f) return <Skeleton lines={6} />;
  const set = (k: string, v: unknown) => setForm({ ...f, [k]: v });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.mutate('PATCH', '/v1/organization', { name: f.name, legalName: f.legalName || null, email: f.email || null, phone: f.phone || null, website: f.website || null, address: { line1: f.line1, city: f.city, region: f.region, postalCode: f.postalCode }, timezone: f.timezone, currency: f.currency, defaultMarkupBp: Math.round(Number(f.defaultMarkup) * 100), defaultTaxBp: Math.round(Number(f.defaultTax) * 100), workingDays: f.workingDays });
      toast({ message: 'Company settings saved.', tone: 'success' }); setForm(null); void refetch();
    } catch (err) { errorToast(err); }
  };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <form onSubmit={save} className="stack" style={{ maxWidth: 760 }}>
      <Card title="Company profile">
        <div className="form-grid">
          <Field label="Company name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Legal name"><Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Website" className="full"><Input value={f.website} onChange={(e) => set('website', e.target.value)} /></Field>
          <Field label="Address" className="full"><Input value={f.line1} onChange={(e) => set('line1', e.target.value)} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Field label="State"><Input value={f.region} onChange={(e) => set('region', e.target.value)} /></Field><Field label="ZIP"><Input value={f.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Field></div>
        </div>
      </Card>
      <Card title="Defaults">
        <div className="form-grid">
          <Field label="Default markup %"><Input inputMode="decimal" value={f.defaultMarkup} onChange={(e) => set('defaultMarkup', e.target.value)} /></Field>
          <Field label="Default tax %"><Input inputMode="decimal" value={f.defaultTax} onChange={(e) => set('defaultTax', e.target.value)} /></Field>
          <Field label="Timezone"><Input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)}>{['USD', 'CAD', 'GBP', 'EUR', 'AUD'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Working days" className="full" hint="Used by the schedule engine when calculating durations and cascades."><div className="row wrap">{days.map((d, i) => <button type="button" key={d} className={`chip ${f.workingDays.includes(i) ? 'on' : ''}`} aria-pressed={f.workingDays.includes(i)} onClick={() => set('workingDays', f.workingDays.includes(i) ? f.workingDays.filter((x: number) => x !== i) : [...f.workingDays, i].sort())}>{d}</button>)}</div></Field>
        </div>
      </Card>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" variant="primary">Save</Button></div>
    </form>
  );
}

function MembersSettings() {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: members, refetch } = useResource<contracts.Member[]>('/v1/members');
  const { data: invitations, refetch: refetchInv } = useResource<contracts.Invitation[]>('/v1/invitations');
  const { data: roles } = useResource<contracts.Role[]>('/v1/roles');
  const [inviting, setInviting] = useState(false);
  const [inv, setInv] = useState({ email: '', roleId: '', firstName: '', lastName: '', message: '' });
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ member: contracts.Member; status: 'active' | 'suspended' } | null>(null);
  const invite = useApiMutation(() => api.mutate<contracts.Invitation>('POST', '/v1/invitations', { ...inv, firstName: inv.firstName || undefined, lastName: inv.lastName || undefined, message: inv.message || undefined }), ['/v1/invitations']);
  const canManage = session.has('members.manage');
  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <Card title={`Members (${members?.length ?? ''})`} actions={session.has('members.invite') && <Button size="sm" variant="primary" icon="plus" onClick={() => setInviting(true)}>Invite</Button>}>
        {!members ? <Skeleton lines={4} /> : <div className="list">{members.map((m) => (
          <div key={m.id} className="list-row" style={{ padding: '8px 0' }}>
            <Avatar name={`${m.firstName} ${m.lastName}`} />
            <span className="grow"><div className="primary">{m.firstName} {m.lastName} {m.userId === session.user?.id && <Badge tone="brand">you</Badge>}{m.status === 'suspended' && <Badge tone="danger">suspended</Badge>}</div><div className="secondary">{m.email} · joined {dateShort(m.joinedAt)}{m.lastActiveAt ? ` · active ${timeAgo(m.lastActiveAt)}` : ''}</div></span>
            <span className="trailing">
              {canManage && roles ? <Select value={m.roleId} aria-label={`Role for ${m.firstName}`} onChange={async (e) => { try { await api.mutate('PATCH', `/v1/members/${m.id}`, { roleId: e.target.value }); toast({ message: 'Role updated.' }); void refetch(); } catch (err) { errorToast(err); } }} style={{ minWidth: 190 }}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select> : <Badge>{m.roleName}</Badge>}
              {canManage && <Input type="number" min={0} step="0.01" aria-label={`Hourly cost for ${m.firstName}`} placeholder="$/h" defaultValue={m.hourlyCostCents != null ? (m.hourlyCostCents / 100).toFixed(2) : ''} style={{ width: 96 }} onBlur={async (e) => { const v = e.target.value.trim(); const cents = v === '' ? null : Math.round(Number(v) * 100); if (Number.isNaN(cents as number) || cents === m.hourlyCostCents) return; try { await api.mutate('PATCH', `/v1/members/${m.id}`, { hourlyCostCents: cents }); toast({ message: 'Hourly cost saved.' }); void refetch(); } catch (err) { errorToast(err); } }} />}
              {canManage && m.userId !== session.user?.id && <Button size="sm" variant={m.status === 'active' ? 'quiet' : 'default'} onClick={() => setConfirm({ member: m, status: m.status === 'active' ? 'suspended' : 'active' })}>{m.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>}
            </span>
          </div>
        ))}</div>}
      </Card>
      <Card title="Pending invitations">
        {!invitations ? <Skeleton /> : invitations.length === 0 ? <p className="muted">No pending invitations.</p> : <div className="list">{invitations.map((i) => <div key={i.id} className="list-row" style={{ padding: '8px 0' }}><span className="grow"><div className="primary">{i.email}</div><div className="secondary">{i.roleName} · invited by {i.invitedByName} · expires {dateShort(i.expiresAt)}</div></span><Button size="sm" variant="quiet" onClick={async () => { await api.mutate('DELETE', `/v1/invitations/${i.id}`); void refetchInv(); }}>Revoke</Button></div>)}</div>}
        {lastLink && <div className="banner syncing mt-2" style={{ borderRadius: 8, wordBreak: 'break-all' }}>Invitation link (email not configured in this environment): <a href={lastLink}>{lastLink}</a></div>}
      </Card>
      <Sheet open={inviting} onClose={() => setInviting(false)} title="Invite a team member" footer={<><Button onClick={() => setInviting(false)}>Cancel</Button><Button variant="primary" loading={invite.isPending} disabled={!inv.email || !inv.roleId} onClick={async () => { try { const r = await invite.mutateAsync(undefined); toast({ message: `Invitation sent to ${r.data.email}.`, tone: 'success' }); setLastLink(r.data.acceptUrl ?? null); setInviting(false); setInv({ email: '', roleId: '', firstName: '', lastName: '', message: '' }); void refetchInv(); } catch (e) { errorToast(e); } }}>Send invitation</Button></>}>
        <div className="form-grid">
          <Field label="Email" className="full"><Input type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} autoFocus autoCapitalize="none" /></Field>
          <Field label="Role" className="full" hint={roles?.find((r) => r.id === inv.roleId)?.description}><Select value={inv.roleId} onChange={(e) => setInv({ ...inv, roleId: e.target.value })}><option value="">Choose a role…</option>{roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="First name"><Input value={inv.firstName} onChange={(e) => setInv({ ...inv, firstName: e.target.value })} /></Field>
          <Field label="Last name"><Input value={inv.lastName} onChange={(e) => setInv({ ...inv, lastName: e.target.value })} /></Field>
          <Field label="Personal message" className="full"><Textarea value={inv.message} onChange={(e) => setInv({ ...inv, message: e.target.value })} /></Field>
        </div>
      </Sheet>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger={confirm?.status === 'suspended'} title={confirm?.status === 'suspended' ? 'Suspend member?' : 'Reactivate member?'} confirmLabel={confirm?.status === 'suspended' ? 'Suspend' : 'Reactivate'} message={confirm?.status === 'suspended' ? `${confirm.member.firstName} will be signed out immediately and lose access until reactivated. Their records stay intact.` : `${confirm?.member.firstName} will regain access with their current role.`} onConfirm={async () => { try { await api.mutate('PATCH', `/v1/members/${confirm!.member.id}`, { status: confirm!.status }); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
    </div>
  );
}

function RolesSettings() {
  const { data: roles, refetch } = useResource<contracts.Role[]>('/v1/roles');
  const [editing, setEditing] = useState<contracts.Role | 'new' | null>(null);
  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <Card title="Roles" actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>Custom role</Button>}>
        {!roles ? <Skeleton lines={5} /> : <div className="list">{roles.map((r) => <button key={r.id} className="list-row" onClick={() => setEditing(r)}><span className="grow"><div className="primary">{r.name} {r.isSystem && <Badge>system</Badge>}{r.external && <Badge tone="info">external</Badge>}</div><div className="secondary">{r.description || `${r.permissions.length} permissions`}</div></span><span className="trailing"><Badge>{r.memberCount ?? 0} member{r.memberCount === 1 ? '' : 's'}</Badge></span></button>)}</div>}
      </Card>
      {editing && <RoleSheet role={editing === 'new' ? null : editing} roles={roles ?? []} onClose={() => { setEditing(null); void refetch(); }} />}
    </div>
  );
}

function RoleSheet({ role, roles, onClose }: { role: contracts.Role | null; roles: contracts.Role[]; onClose: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ name: role?.name ?? '', description: role?.description ?? '', restrictToAssignedProjects: role?.restrictToAssignedProjects ?? true, external: role?.external ?? false, defaultMode: role?.defaultMode ?? 'office', permissions: new Set(role?.permissions ?? []), cloneFromRoleId: '' });
  const [deleting, setDeleting] = useState(false);
  const locked = role?.key === 'owner';
  const groups = Object.entries(PERMISSIONS.reduce<Record<string, string[]>>((acc, p) => { const g = p.split('.')[0]!; (acc[g] ??= []).push(p); return acc; }, {}));
  const save = async () => {
    try {
      const body = { name: form.name, description: form.description, restrictToAssignedProjects: form.restrictToAssignedProjects, external: form.external, defaultMode: form.defaultMode, permissions: [...form.permissions] };
      if (role) await api.mutate('PATCH', `/v1/roles/${role.id}`, body); else await api.mutate('POST', '/v1/roles', { ...body, cloneFromRoleId: form.cloneFromRoleId || undefined });
      toast({ message: 'Role saved.', tone: 'success' }); onClose();
    } catch (e) { errorToast(e); }
  };
  return (
    <Sheet open onClose={onClose} title={role ? role.name : 'New role'} size="lg" footer={<>{role && !role.isSystem && <Button variant="danger" onClick={() => setDeleting(true)}>Delete</Button>}<span className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={locked || !form.name} onClick={save}>Save</Button></>}>
      {locked && <div className="banner syncing mb-4" style={{ borderRadius: 8 }}>The Owner role always has every permission and cannot be edited.</div>}
      <div className="form-grid">
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={locked} /></Field>
        {!role && <Field label="Start from"><Select value={form.cloneFromRoleId} onChange={(e) => { const src = roles.find((r) => r.id === e.target.value); setForm({ ...form, cloneFromRoleId: e.target.value, permissions: new Set(src?.permissions ?? []) }); }}><option value="">Blank</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>}
        <Field label="Description" className="full"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={locked} /></Field>
        <Field label="Default experience"><Select value={form.defaultMode} onChange={(e) => setForm({ ...form, defaultMode: e.target.value as any })} disabled={locked}><option value="office">Office</option><option value="field">Field</option><option value="portal">Portal</option></Select></Field>
        <div className="full stack-sm">
          <Switch label="Only assigned projects" hint="Limits project data to projects where the person is a member." checked={form.restrictToAssignedProjects} onChange={(v) => setForm({ ...form, restrictToAssignedProjects: v })} />
          <Switch label="External (client or vendor)" hint="Never sees internal-only notes, files or messages." checked={form.external} onChange={(v) => setForm({ ...form, external: v })} />
        </div>
        <div className="full"><h4 className="mb-2">Permissions</h4>
          {groups.map(([g, perms]) => <div key={g} className="row wrap mb-2"><span style={{ width: 130, fontWeight: 600, textTransform: 'capitalize' }}>{g.replace('_', ' ')}</span>{perms.map((p) => <button key={p} type="button" className={`chip ${form.permissions.has(p) ? 'on' : ''}`} aria-pressed={form.permissions.has(p)} disabled={locked} onClick={() => { const s = new Set(form.permissions); if (s.has(p)) s.delete(p); else s.add(p); setForm({ ...form, permissions: s }); }}>{p.split('.')[1]}</button>)}</div>)}
        </div>
      </div>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} danger title="Delete role?" confirmLabel="Delete" message="Members must be reassigned before a role can be deleted." onConfirm={async () => { try { await api.mutate('DELETE', `/v1/roles/${role!.id}`); onClose(); } catch (e) { errorToast(e); throw e; } }} />
    </Sheet>
  );
}

const STANDALONE = import.meta.env.VITE_STANDALONE === '1';
const KEY_STORAGE = 'buildline.anthropicKey';

/** Shows which brain the assistant is using. In the demo build the key lives only in this browser and is sent straight to Anthropic. */
function AiSettings() {
  const toast = useToast();
  const { data: status } = useResource<contracts.AiStatus>('/v1/ai/status');
  const [key, setKey] = useState(() => { try { return STANDALONE ? localStorage.getItem(KEY_STORAGE) ?? '' : ''; } catch { return ''; } });
  const [saved, setSaved] = useState(false);
  const save = (e: FormEvent) => {
    e.preventDefault();
    try { if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim()); else localStorage.removeItem(KEY_STORAGE); } catch { toast({ message: 'This browser blocks saved settings.', tone: 'error' }); return; }
    setSaved(true);
    toast({ message: key.trim() ? 'Key saved. Reloading so the assistant can use it…' : 'Key removed. Reloading…', tone: 'success' });
    setTimeout(() => window.location.reload(), 800);
  };
  return <div className="stack" style={{ maxWidth: 640 }}>
    <h2>AI assistant</h2>
    <Card>
      <div className="stack-sm">
        <div className="row"><strong className="grow">Status</strong>{status ? <Badge tone={status.provider === 'rules' ? 'warning' : 'success'}>{status.provider === 'rules' ? 'Built-in answers (no AI model)' : `Connected · ${status.model}`}</Badge> : <Skeleton lines={1} />}</div>
        <p className="muted">The assistant only ever sees what you can see: every fact comes from a tool that runs with your own permissions, and anything that changes data waits for you to confirm it.</p>
        {status && <p className="subtle">{status.tools.length} tools available to you: {status.tools.map((t) => t.name.replace(/_/g, ' ')).join(', ')}.</p>}
      </div>
    </Card>
    {STANDALONE ? <Card>
      <form className="stack-sm" onSubmit={save}>
        <strong>Connect Claude (optional)</strong>
        <p className="muted">Paste an Anthropic API key to let the assistant answer in natural language. In this demo the key is kept in this browser only and requests go directly to Anthropic, so it never passes through a server we run. Leave it empty to keep the built-in answers.</p>
        <Field label="Anthropic API key"><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" data-testid="ai-key" /></Field>
        <div className="row"><Button type="submit" variant="primary" disabled={saved}>Save and reload</Button>{key && <Button type="button" onClick={() => { setKey(''); }}>Clear</Button>}</div>
      </form>
    </Card> : <Card>
      <div className="stack-sm">
        <strong>Connecting an AI model</strong>
        <p className="muted">Your administrator sets the model on the server (the <code>ANTHROPIC_API_KEY</code> and <code>AI_MODEL</code> settings). Without a key the assistant still answers everyday questions using its built-in understanding of your projects.</p>
      </div>
    </Card>}
  </div>;
}
