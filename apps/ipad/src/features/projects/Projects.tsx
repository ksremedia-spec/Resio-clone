import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, EmptyState, ErrorState, Icon, SearchField, Segmented, Skeleton, StatusBadge, Toolbar, useDebounced, useKeyboardShortcut } from '../../ui/components';
import { dateShort, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { ProjectFormSheet } from './ProjectForm';

export default function Projects() {
  const session = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'open' | 'active' | 'complete' | 'archived'>('open');
  const debounced = useDebounced(q);
  const creating = params.get('new') === '1';
  const url = `/v1/projects?status=${status}&limit=100&sort=updatedAt:desc${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`;
  const { data, isLoading, error, refetch, fromCache } = useResource<{ items: contracts.ProjectSummary[] }>(url);
  useKeyboardShortcut('mod+n', () => { if (session.has('projects.write')) setParams({ new: '1' }); });
  const items = data?.items ?? [];
  const favourites = items.filter((p) => p.isFavorite);
  const rest = items.filter((p) => !p.isFavorite);
  const row = (p: contracts.ProjectSummary) => (
    <button key={p.id} className="list-row" onClick={() => navigate(`/projects/${p.id}`)} data-testid="project-row">
      <span className="dot" style={{ background: p.color, width: 12, height: 12 }} />
      <span className="grow"><div className="primary truncate">{p.isFavorite && '★ '}{p.number} · {p.name}</div><div className="secondary truncate">{p.clientName ?? 'No client'}{p.address.city ? ` · ${p.address.city}` : ''}{p.startDate ? ` · ${dateShort(p.startDate)}${p.targetEndDate ? ` → ${dateShort(p.targetEndDate)}` : ''}` : ''}</div></span>
      <span className="trailing"><span className="num muted">{p.contractValueCents ? money(p.contractValueCents) : ''}</span><StatusBadge status={p.status} /><Icon name="chevronRight" size={16} /></span>
    </button>
  );
  return <>
    <Toolbar title="Projects" leading={<MenuToggle />}>
      {fromCache && <Badge tone="warning">Cached</Badge>}
      {session.has('projects.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New project</Button>}
      <ToolbarActions />
    </Toolbar>
    <div className="page"><div className="page-inner stack">
      <div className="row wrap">
        <div className="grow" style={{ maxWidth: 420 }}><SearchField value={q} onChange={setQ} placeholder="Search projects" /></div>
        <Segmented value={status} onChange={setStatus} ariaLabel="Project status" options={[{ value: 'open', label: 'Open' }, { value: 'active', label: 'Active' }, { value: 'complete', label: 'Complete' }, { value: 'archived', label: 'Archived' }]} />
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
      {data && items.length === 0 && <EmptyState icon="projects" title={debounced ? 'No matching projects' : 'No projects yet'} action={session.has('projects.write') && !debounced ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Create your first project</Button> : undefined}>{debounced ? 'Try a different name or number.' : 'Projects connect schedules, logs, documents and finances in one place.'}</EmptyState>}
      {favourites.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="sidebar-section">Favourites</div><div className="list">{favourites.map(row)}</div></div>}
      {rest.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{rest.map(row)}</div></div>}
    </div></div>
    {creating && <ProjectFormSheet open onClose={() => setParams({})} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
  </>;
}
