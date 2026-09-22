import { useNavigate, useParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, Icon, ListRow, Select, Skeleton, Toolbar } from '../../ui/components';
import { dateShort, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import type { IconName } from '../../ui/icons';
import { ClockWidget } from '../time/ClockWidget';

/**
 * Field mode: one project, six big actions, today's work. Designed for a
 * supervisor or crew member holding an iPad on site. Every tile is a single
 * tap into the fastest path for that job.
 */
export default function FieldMode() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>('/v1/projects?status=open&limit=50');
  const chosen = projectId ?? projects?.items[0]?.id;
  const { data: project, isLoading } = useResource<contracts.ProjectDetail>(chosen ? `/v1/projects/${chosen}` : null);
  const today = todayIso();
  const { data: myTasks } = useResource<{ items: contracts.Task[] }>(chosen ? `/v1/projects/${chosen}/tasks?status=open&limit=50&sort=startDate:asc` : null);
  const todays = (myTasks?.items ?? []).filter((t) => (t.startDate && t.endDate && t.startDate <= today && t.endDate >= today) || t.dueDate === today || (t.dueDate && t.dueDate < today));
  const tiles = ([
    { icon: 'log', label: 'Daily log', to: `/projects/${chosen}/daily-logs?new=1`, primary: true, perm: 'daily_logs.write' },
    { icon: 'camera', label: 'Take photo', to: `/projects/${chosen}/documents?capture=1`, perm: 'documents.write' },
    { icon: 'schedule', label: "Today's schedule", to: `/projects/${chosen}/schedule`, perm: 'schedule.read' },
    { icon: 'documents', label: 'Plans & docs', to: `/projects/${chosen}/documents`, perm: 'documents.read' },
    { icon: 'layout', label: 'Client selections', to: `/projects/${chosen}/selections/sheet`, perm: 'selections.read' },
    { icon: 'messages', label: 'Messages', to: `/projects/${chosen}/messages`, perm: 'messages.read' },
    { icon: 'clock', label: 'Time clock', to: `/projects/${chosen}/time`, perm: 'time.clock' },
  ] as Array<{ icon: IconName; label: string; to: string; primary?: boolean; perm?: string }>).filter((t) => !t.perm || session.has(t.perm));
  return <>
    <Toolbar title="Field mode" leading={<MenuToggle />}>
      {projects && <Select value={chosen ?? ''} onChange={(e) => navigate(`/field/${e.target.value}`)} aria-label="Project" style={{ maxWidth: 360 }}>{projects.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select>}
      <ToolbarActions />
    </Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-5)' }}>
      {!chosen && projects && <EmptyState icon="hardhat" title="No open projects assigned to you">Ask a project manager to add you to a project.</EmptyState>}
      {isLoading && !project && <Skeleton lines={4} />}
      {project && <>
        <div className="row-between"><div><h2>{project.name}</h2><div className="subtle">{project.address.line1}{project.address.city ? `, ${project.address.city}` : ''} · {dateShort(today)}</div></div><Button variant="quiet" onClick={() => navigate(`/projects/${project.id}`)}>Open project hub <Icon name="arrowRight" size={16} /></Button></div>
        {session.has('time.clock') && <Card title="Time clock"><ClockWidget projectId={project.id} /></Card>}
        <div className="field-grid">{tiles.map((t) => <button key={t.label} className={`field-tile ${t.primary ? 'primary' : ''}`} onClick={() => navigate(t.to)}><Icon name={t.icon} size={36} /><span className="label">{t.label}</span></button>)}</div>
        <Card title="Today's tasks" actions={<a onClick={() => navigate(`/projects/${project.id}/tasks`)}>All tasks</a>}>
          {todays.length === 0 ? <p className="muted">Nothing scheduled for today on this project.</p> : <div className="list">{todays.map((t) => <ListRow key={t.id} onClick={() => navigate(`/projects/${project.id}/tasks/${t.id}`)} leading={<Icon name={t.status === 'complete' ? 'checkCircle' : t.isMilestone ? 'flag' : 'circle'} />} primary={t.name} secondary={`${t.assignees.map((a) => a.displayName).join(', ') || 'Unassigned'}${t.endDate ? ` · until ${dateShort(t.endDate)}` : ''}`} trailing={<>{t.dueDate && t.dueDate < today && <Badge tone="danger">overdue</Badge>}<Badge>{t.status.replace('_', ' ')}</Badge></>} />)}</div>}
        </Card>
      </>}
    </div></div>
  </>;
}
