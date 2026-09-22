import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Button, EmptyState, ErrorState, Segmented, Skeleton, Toolbar, useContextMenu, useErrorToast } from '../../ui/components';
import { todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { TaskRow } from './ProjectTasks';

/** Cross-project task manager: ticket-style, grouped by date, two-week window, overdue first. */
export default function TaskManager() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [scope, setScope] = useState<'mine' | 'all'>(params.get('scope') === 'all' || params.get('scope') === 'mine' ? (params.get('scope') as 'mine' | 'all') : session.membership?.roleKey === 'owner' || session.membership?.roleKey === 'project_manager' ? 'all' : 'mine');
  const [kind, setKind] = useState<'all' | 'schedule' | 'todo'>('all');
  const today = todayIso();
  const twoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Task[] }>(`/v1/tasks?status=open&kind=${kind}&limit=200&sort=dueDate:asc${scope === 'mine' ? '&mine=true' : ''}&dueBefore=${twoWeeks}`);
  const errorToast = useErrorToast();
  const toggle = useApiMutation((t: contracts.Task) => api.mutate('PATCH', `/v1/tasks/${t.id}`, { status: t.status === 'complete' ? 'not_started' : 'complete' }, { queue: { entity: 'task', label: `Complete "${t.name}"`, optimistic: t, invalidates: ['/v1/tasks', '/v1/projects'] } }), ['/v1/tasks', '/v1/projects', '/v1/dashboard']);
  const { bind, element } = useContextMenu();
  const items = data?.items ?? [];
  const byDate = new Map<string, contracts.Task[]>();
  for (const t of items) { const d = t.dueDate ?? t.endDate ?? ''; const key = d && d < today ? 'Overdue' : d === today ? 'Today' : d || 'No date'; (byDate.get(key) ?? byDate.set(key, []).get(key)!).push(t); }
  const order = [...byDate.keys()].sort((a, b) => (a === 'Overdue' ? -1 : b === 'Overdue' ? 1 : a === 'Today' ? -1 : b === 'Today' ? 1 : a.localeCompare(b)));
  return <>
    <Toolbar title="Tasks" leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack">
      <div className="row wrap">
        <Segmented value={scope} onChange={setScope} ariaLabel="Scope" options={[{ value: 'mine', label: 'Assigned to me' }, { value: 'all', label: 'Everyone' }]} />
        <Segmented value={kind} onChange={setKind} ariaLabel="Type" options={[{ value: 'all', label: 'All' }, { value: 'schedule', label: 'Schedule' }, { value: 'todo', label: 'To-dos' }]} />
        <span className="subtle">Next two weeks</span>
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
      {data && items.length === 0 && <EmptyState icon="tasks" title="Nothing due in the next two weeks">Tasks you are assigned across all projects show up here.</EmptyState>}
      {order.map((key) => <div key={key} className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="sidebar-section" style={{ color: key === 'Overdue' ? 'var(--danger)' : undefined }}>{key.match(/^\d/) ? new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : key} · {byDate.get(key)!.length}</div><div className="list">{byDate.get(key)!.map((t) => <TaskRow key={t.id} t={t} today={today} showProject onOpen={() => navigate(`/projects/${t.projectId}/tasks/${t.id}`)} onToggle={() => toggle.mutateAsync(t).catch(errorToast)} bind={bind} />)}</div></div>)}
      {element}
      {session.has('projects.read') && <Button variant="quiet" onClick={() => navigate('/projects')}>Open a project to add tasks</Button>}
    </div></div>
  </>;
}
