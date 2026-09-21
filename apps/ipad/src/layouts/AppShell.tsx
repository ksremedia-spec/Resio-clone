import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { NAV_PERMISSIONS, type contracts } from '@buildline/core';
import { useSession } from '../store/session';
import { on } from '../store/events';
import { db, type OutboxItem } from '../store/db';
import { discardItem, pendingCount, processOutbox, retryItem } from '../store/sync';
import { useResource, useInvalidateOnEvents, api } from '../api/hooks';
import { Badge, Button, Icon, Menu, Popover, Sheet, useDebounced, useIsCompact, useKeyboardShortcut, useToast } from '../ui/components';
import type { IconName } from '../ui/icons';
import { timeAgo } from '../ui/format';

const NAV: Array<{ key: keyof typeof NAV_PERMISSIONS; to: string; label: string; icon: IconName; shortcut?: string; section?: string }> = [
  { key: 'dashboard', to: '/', label: 'Dashboard', icon: 'dashboard', shortcut: '1' },
  { key: 'projects', to: '/projects', label: 'Projects', icon: 'projects', shortcut: '2' },
  { key: 'leads', to: '/leads', label: 'Leads', icon: 'leads', shortcut: '3' },
  { key: 'schedule', to: '/schedule', label: 'Schedule', icon: 'schedule', shortcut: '4' },
  { key: 'tasks', to: '/tasks', label: 'Tasks', icon: 'tasks', shortcut: '5' },
  { key: 'clients', to: '/clients', label: 'Clients', icon: 'clients', section: 'People' },
  { key: 'vendors', to: '/vendors', label: 'Vendors', icon: 'vendors' },
  { key: 'estimating', to: '/estimating', label: 'Estimating', icon: 'estimating', section: 'Money' },
  { key: 'budget', to: '/budget', label: 'Budget', icon: 'budget' },
  { key: 'invoices', to: '/invoices', label: 'Invoices', icon: 'invoices' },
  { key: 'messages', to: '/messages', label: 'Messages', icon: 'messages', section: 'Work' },
  { key: 'documents', to: '/documents', label: 'Documents', icon: 'documents' },
  { key: 'reports', to: '/reports', label: 'Reports', icon: 'reports' },
  { key: 'ai', to: '/assistant', label: 'AI Assistant', icon: 'ai' },
  { key: 'settings', to: '/settings', label: 'Settings', icon: 'settings', section: 'Company' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const compact = useIsCompact();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useInvalidateOnEvents();
  useEffect(() => setOpen(false), [location.pathname]);
  for (const item of NAV.filter((n) => n.shortcut)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useKeyboardShortcut(`mod+${item.shortcut}`, () => navigate(item.to));
  }
  const sidebar = (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /> Buildline{compact && <button className="btn quiet icon" style={{ marginLeft: 'auto' }} aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="close" /></button>}</div>
      <div className="sidebar-nav">
        {session.membership?.defaultMode === 'field' && <NavLink to="/field" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="hardhat" /> Field mode</NavLink>}
        {NAV.filter((n) => { const p = NAV_PERMISSIONS[n.key]; return !p || session.has(p); }).map((n) => (
          <div key={n.key}>
            {n.section && <div className="sidebar-section">{n.section}</div>}
            <NavLink to={n.to} end={n.to === '/'} aria-label={n.label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name={n.icon} />{n.label}{n.shortcut && !compact && <span className="kbd" aria-hidden="true">⌘{n.shortcut}</span>}</NavLink>
          </div>
        ))}
        <FavoriteProjects />
      </div>
      <div className="sidebar-footer"><OrgSwitcher /></div>
    </nav>
  );
  return (
    <div className={`shell ${compact ? 'collapsed' : ''}`}>
      {!compact && sidebar}
      {compact && open && <div className="sidebar-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>{sidebar}</div>}
      <div className="content">
        <ConnectivityBanner />
        <ShellContext.Provider value={{ openSidebar: () => setOpen(true), compact }}>{children}</ShellContext.Provider>
      </div>
      <CommandPalette />
    </div>
  );
}

import { createContext, useContext } from 'react';
const ShellContext = createContext<{ openSidebar: () => void; compact: boolean }>({ openSidebar: () => {}, compact: false });
export const useShell = () => useContext(ShellContext);

/** Toolbar leading control: hamburger in compact layouts. */
export function MenuToggle() {
  const { openSidebar, compact } = useShell();
  if (!compact) return null;
  return <button className="btn quiet icon" aria-label="Open menu" onClick={openSidebar}><Icon name="menu" /></button>;
}

export function ToolbarActions() {
  return <div className="row"><SearchButton /><NotificationsButton /></div>;
}

function FavoriteProjects() {
  const session = useSession();
  const { data } = useResource<{ items: contracts.ProjectSummary[] }>(session.has('projects.read') ? '/v1/projects?favorites=true&limit=8' : null);
  if (!data?.items.length) return null;
  return <>
    <div className="sidebar-section">Favourites</div>
    {data.items.map((p) => <NavLink key={p.id} to={`/projects/${p.id}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><span className="dot" style={{ background: p.color }} /><span className="truncate">{p.name}</span></NavLink>)}
  </>;
}

function OrgSwitcher() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const close = useCallback(() => setOpen(false), []);
  const name = session.user ? `${session.user.firstName} ${session.user.lastName}` : '';
  return <>
    <button ref={ref} className="nav-item" style={{ width: '100%' }} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
      <span className="avatar sm">{name.split(' ').map((s) => s[0]).join('')}</span>
      <span className="grow" style={{ textAlign: 'left' }}><div className="truncate" style={{ fontWeight: 600, color: 'var(--fg)' }}>{session.membership?.organization.name}</div><div className="subtle truncate">{name} · {session.membership?.roleName}</div></span>
      <Icon name="chevronDown" size={16} />
    </button>
    <Popover anchor={ref.current} open={open} onClose={close} align="start">
      <Menu onClose={close} items={[
        ...session.memberships.filter((m) => m.status === 'active').map((m) => ({ label: `${m.organization.id === session.organizationId ? '✓ ' : ''}${m.organization.name}`, icon: 'building' as IconName, onSelect: () => { if (m.organization.id !== session.organizationId) void session.switchOrganization(m.organization.id).then(() => navigate('/')); } })),
        { label: '', separator: true, onSelect: () => {} },
        { label: 'Profile & security', icon: 'settings', onSelect: () => navigate('/settings/profile') },
        { label: 'Sign out', icon: 'external', danger: true, onSelect: () => { void session.signOut(); } },
      ]} />
    </Popover>
  </>;
}

function ConnectivityBanner() {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [show, setShow] = useState(false);
  const toast = useToast();
  const refresh = useCallback(async () => { setPending(await pendingCount()); setItems(await db.outbox.orderBy('createdAt').toArray()); }, []);
  useEffect(() => { void refresh(); const a = on('offline', (v: boolean) => setOffline(v)); const b = on('outbox', () => void refresh()); const c = on('outbox:changed', () => void refresh()); return () => { a(); b(); c(); }; }, [refresh]);
  useEffect(() => { const h = () => setOffline(false); window.addEventListener('online', h); return () => window.removeEventListener('online', h); }, []);
  const attention = items.filter((i) => i.status === 'needs_attention').length;
  if (!offline && pending === 0) return null;
  return <>
    <div className={`banner ${offline ? 'offline' : 'syncing'}`} role="status">
      <Icon name={offline ? 'wifiOff' : 'refresh'} size={18} />
      <span className="grow">{offline ? 'You are offline. Changes are saved on this iPad and will sync when you reconnect.' : `Syncing ${pending} change${pending === 1 ? '' : 's'}…`}{attention > 0 && ` ${attention} need${attention === 1 ? 's' : ''} attention.`}</span>
      {pending > 0 && <Button size="sm" onClick={() => setShow(true)}>{pending} queued</Button>}
      {!offline && <Button size="sm" variant="ghost" icon="refresh" onClick={() => { void processOutbox().then((r) => toast({ message: r.sent ? `Synced ${r.sent} change${r.sent === 1 ? '' : 's'}.` : 'Nothing to sync yet.' })); }}>Sync now</Button>}
    </div>
    <Sheet open={show} onClose={() => setShow(false)} title="Queued changes">
      {items.length === 0 ? <p className="muted">Everything is synced.</p> : <div className="list">{items.map((i) => (
        <div key={i.id} className="list-row" style={{ alignItems: 'flex-start' }}>
          <span className="grow"><div className="primary">{i.label}</div><div className="secondary">{i.status === 'needs_attention' ? `Needs attention: ${i.lastError}` : i.status === 'sending' ? 'Sending…' : `Queued ${timeAgo(new Date(i.createdAt).toISOString())}${i.attempts ? ` · ${i.attempts} attempt${i.attempts === 1 ? '' : 's'}` : ''}`}</div></span>
          <span className="trailing">{i.status === 'needs_attention' && <Button size="sm" onClick={() => void retryItem(i.id!)}>Retry</Button>}<Button size="sm" variant="quiet" icon="trash" aria-label="Discard" onClick={() => { if (confirm('Discard this unsent change? It cannot be recovered.')) void discardItem(i.id!); }} /></span>
        </div>
      ))}</div>}
    </Sheet>
  </>;
}

function SearchButton() {
  return <button className="btn quiet" aria-label="Search (⌘K)" onClick={() => window.dispatchEvent(new CustomEvent('buildline:palette'))}><Icon name="search" /><span className="kbd">⌘K</span></button>;
}

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { data, refetch } = useResource<{ items: contracts.Notification[]; unreadCount: number }>('/v1/notifications?limit=20', { refetchInterval: 45_000 } as any);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button ref={ref} className="btn quiet icon" aria-label={`Notifications${data?.unreadCount ? `, ${data.unreadCount} unread` : ''}`} onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
      <Icon name="bell" />{!!data?.unreadCount && <span className="badge count" style={{ position: 'absolute', top: 2, right: 2, fontSize: 10, padding: '0 5px', minWidth: 16 }}>{data.unreadCount}</span>}
    </button>
    <Popover anchor={ref.current} open={open} onClose={close}>
      <div style={{ width: 380, maxHeight: '70vh', overflowY: 'auto' }}>
        <div className="row-between" style={{ padding: '8px 12px' }}><strong>Notifications</strong>{!!data?.unreadCount && <Button size="sm" variant="ghost" onClick={async () => { await api.mutate('POST', '/v1/notifications/all/read'); void refetch(); }}>Mark all read</Button>}</div>
        {data?.items.length ? data.items.map((n) => (
          <button key={n.id} className="menu-item" style={{ alignItems: 'flex-start', padding: '8px 12px', height: 'auto' }} onClick={async () => { close(); if (!n.readAt) { await api.mutate('POST', `/v1/notifications/${n.id}/read`); void refetch(); } if (n.link) navigate(n.link); }}>
            <span className="dot" style={{ background: n.readAt ? 'transparent' : 'var(--brand)', marginTop: 8 }} />
            <span className="grow"><div style={{ fontWeight: n.readAt ? 500 : 700 }}>{n.title}</div><div className="subtle" style={{ whiteSpace: 'normal' }}>{n.body}</div><div className="subtle">{timeAgo(n.createdAt)}</div></span>
          </button>
        )) : <p className="muted" style={{ padding: 12 }}>You're all caught up.</p>}
      </div>
    </Popover>
  </>;
}

function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const debounced = useDebounced(q, 200);
  const { data, isFetching } = useResource<{ results: contracts.SearchResult[] }>(open && debounced.trim().length >= 2 ? `/v1/search?q=${encodeURIComponent(debounced.trim())}&limit=12` : null, { staleTime: 5_000 } as any);
  useKeyboardShortcut('mod+k', () => setOpen(true));
  useEffect(() => { const h = () => setOpen(true); window.addEventListener('buildline:palette', h); return () => window.removeEventListener('buildline:palette', h); }, []);
  useEffect(() => { if (!open) { setQ(''); setActive(0); } }, [open]);
  const results = data?.results ?? [];
  const go = (r: contracts.SearchResult) => { setOpen(false); navigate(r.link); };
  const icons: Record<string, IconName> = { project: 'projects', client: 'clients', contact: 'leads', vendor: 'vendors', task: 'tasks', document: 'file', message: 'messages', daily_log: 'log', lead: 'leads', estimate: 'estimating', change_order: 'edit', invoice: 'invoices' };
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Search" leading={<span style={{ width: 72 }} />}>
      <div className="stack">
        <input className="input" autoFocus placeholder="Search projects, clients, tasks, documents, messages…" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} aria-label="Global search"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } if (e.key === 'Enter' && results[active]) go(results[active]!); }} />
        {isFetching && <div className="subtle">Searching…</div>}
        <div className="palette" style={{ margin: 0, width: 'auto' }}>
          {results.map((r, i) => <button key={`${r.type}-${r.id}`} className={`result ${i === active ? 'active' : ''}`} onClick={() => go(r)} onMouseEnter={() => setActive(i)}><Icon name={icons[r.type] ?? 'file'} /><span className="grow"><div style={{ fontWeight: 600 }}>{r.title}</div><div className="subtle">{r.subtitle}</div></span><Badge>{r.type.replace('_', ' ')}</Badge></button>)}
          {debounced.trim().length >= 2 && !isFetching && results.length === 0 && <p className="muted">No matches for “{debounced}”.</p>}
        </div>
      </div>
    </Sheet>
  );
}
