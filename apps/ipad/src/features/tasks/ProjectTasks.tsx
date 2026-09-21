import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, EmptyState, ErrorState, Icon, Segmented, Skeleton, SwipeRow, useContextMenu, useErrorToast, useKeyboardShortcut } from '../../ui/components';
import { dateShort, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { TaskSheet } from './TaskSheet';

export default function ProjectTasks({ project }: { project: contracts.ProjectDetail }) {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'complete' | 'all'>('open');
  const [kind, setKind] = useState<'all' | 'todo' | 'schedule'>('all');
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Task[] }>(`/v1/projects/${project.id}/tasks?status=${status}&kind=${kind}&limit=200&sort=dueDate:asc`);
  const { data: selected } = useResource<contracts.Task>(taskId ? `/v1/tasks/${taskId}` : null);
  const errorToast = useErrorToast();
  const complete = useApiMutation((t: contracts.Task) => api.mutate('PATCH', `/v1/tasks/${t.id}`, { status: t.status === 'complete' ? 'not_started' : 'complete' }, { queue: { entity: 'task', label: `Complete "${t.name}"`, optimistic: t, invalidates: [`/v1/projects/${project.id}`, '/v1/tasks'] } }), [`/v1/projects/${project.id}`, '/v1/tasks', '/v1/dashboard']);
  const { bind, element } = useContextMenu();
  useKeyboardShortcut('mod+n', () => { if (session.has('tasks.write')) setParams({ new: 'todo' }); });
  const today = todayIso();
  const creating = params.get('new');
  const canWrite = session.has('tasks.write') || session.has('schedule.write');
  const items = data?.items ?? [];
  const groups: Array<[string, contracts.Task[]]> = [
    ['Overdue', items.filter((t) => t.status !== 'complete' && (t.dueDate ?? t.endDate) && (t.dueDate ?? t.endDate)! < today)],
    ['Today', items.filter((t) => (t.dueDate ?? t.endDate) === today)],
    ['Upcoming', items.filter((t) => (t.dueDate ?? t.endDate) && (t.dueDate ?? t.endDate)! > today)],
    ['No date', items.filter((t) => !(t.dueDate ?? t.endDate))],
  ];
  if (status !== 'open') groups.length = 0;
  return (
    <div className="page-inner stack">
      <div className="row wrap">
        <Segmented value={status} onChange={setStatus} ariaLabel="Task status" options={[{ value: 'open', label: 'Open' }, { value: 'complete', label: 'Complete' }, { value: 'all', label: 'All' }]} />
        <Segmented value={kind} onChange={setKind} ariaLabel="Task type" options={[{ value: 'all', label: 'All' }, { value: 'schedule', label: 'Schedule' }, { value: 'todo', label: 'To-dos' }]} />
        <span className="grow" />
        {canWrite && <><Button icon="plus" onClick={() => setParams({ new: 'todo' })}>To-do</Button>{session.has('schedule.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: 'schedule' })}>Task</Button>}</>}
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
      {data && items.length === 0 && <EmptyState icon="tasks" title={status === 'open' ? 'No open tasks' : 'No tasks'} action={canWrite ? <Button variant="primary" onClick={() => setParams({ new: 'todo' })}>Add a to-do</Button> : undefined} />}
      {status === 'open' ? groups.filter(([, g]) => g.length).map(([label, g]) => <div key={label} className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="sidebar-section">{label} · {g.length}</div><div className="list">{g.map((t) => <TaskRow key={t.id} t={t} today={today} onOpen={() => navigate(`/projects/${project.id}/tasks/${t.id}`)} onToggle={() => complete.mutateAsync(t).catch(errorToast)} bind={bind} />)}</div></div>)
        : items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((t) => <TaskRow key={t.id} t={t} today={today} onOpen={() => navigate(`/projects/${project.id}/tasks/${t.id}`)} onToggle={() => complete.mutateAsync(t).catch(errorToast)} bind={bind} />)}</div></div>}
      {element}
      {creating && <TaskSheet projectId={project.id} defaults={{ kind: creating === 'schedule' ? 'schedule' : 'todo' }} onClose={() => setParams({})} />}
      {taskId && selected && <TaskSheet projectId={project.id} task={selected} onClose={() => navigate(`/projects/${project.id}/tasks`)} />}
    </div>
  );
}

export function TaskRow({ t, today, onOpen, onToggle, bind, showProject }: { t: contracts.Task; today: string; onOpen: () => void; onToggle: () => void; bind: (items: any[]) => any; showProject?: boolean }) {
  const due = t.dueDate ?? t.endDate;
  const overdue = t.status !== 'complete' && due && due < today;
  return (
    <SwipeRow actions={[{ label: t.status === 'complete' ? 'Reopen' : 'Complete', tone: 'success', onSelect: onToggle }]}>
      <div className="list-row" {...bind([{ label: t.status === 'complete' ? 'Mark not started' : 'Mark complete', icon: 'check', onSelect: onToggle }, { label: 'Open', icon: 'edit', onSelect: onOpen }])}>
        <button className="btn quiet icon" aria-label={t.status === 'complete' ? 'Mark incomplete' : 'Mark complete'} aria-pressed={t.status === 'complete'} onClick={onToggle}><Icon name={t.status === 'complete' ? 'checkCircle' : t.isMilestone ? 'flag' : 'circle'} style={{ color: t.status === 'complete' ? 'var(--success)' : undefined }} /></button>
        <button className="grow" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, minWidth: 0 }} onClick={onOpen} data-testid="task-row">
          <div className="primary truncate" style={{ textDecoration: t.status === 'complete' ? 'line-through' : undefined, color: t.status === 'complete' ? 'var(--fg-3)' : undefined }}>{t.name}</div>
          <div className="secondary truncate">{showProject && t.projectName ? `${t.projectName} · ` : ''}{t.kind === 'todo' ? 'To-do' : `${dateShort(t.startDate)} → ${dateShort(t.endDate)}`}{t.assignees.length ? ` · ${t.assignees.map((a) => a.displayName).join(', ')}` : ''}{t.checklist.length ? ` · ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : ''}</div>
        </button>
        <span className="trailing">{overdue && <Badge tone="danger">{Math.floor((Date.parse(today) - Date.parse(due!)) / 86_400_000)}d late</Badge>}{t.priority === 'high' && <Badge tone="danger">high</Badge>}{t.status === 'in_progress' && <Badge tone="brand">in progress</Badge>}{t.status === 'blocked' && <Badge tone="danger">blocked</Badge>}<Icon name="chevronRight" size={16} /></span>
      </div>
    </SwipeRow>
  );
}
