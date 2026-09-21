import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { Badge, Button, Card, Icon, Progress, Stat } from '../../ui/components';
import { dateLong, dateShort, money, timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';

export function ProjectOverview({ project }: { project: contracts.ProjectDetail }) {
  const navigate = useNavigate();
  const session = useSession();
  const { data: activity } = useResource<{ items: contracts.ActivityEntry[] }>(session.has('activity.read') ? `/v1/projects/${project.id}/activity?limit=8` : null);
  const { data: schedule } = useResource<contracts.ScheduleResponse>(session.has('schedule.read') ? `/v1/projects/${project.id}/schedule` : null);
  const f = project.financials;
  const tasks = schedule?.tasks ?? [];
  const done = tasks.filter((t) => t.status === 'complete').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const upcoming = tasks.filter((t) => t.status !== 'complete' && t.status !== 'cancelled' && t.startDate).sort((a, b) => a.startDate!.localeCompare(b.startDate!)).slice(0, 5);
  const milestones = tasks.filter((t) => t.isMilestone && t.status !== 'complete').sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '')).slice(0, 4);
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="stat-row">
        <Stat label="Contract" value={money(f.revisedContractCents)} />
        <Stat label="Approved changes" value={money(f.approvedChangesCents)} />
        <Stat label="Invoiced" value={money(f.invoicedCents)} />
        <Stat label="Outstanding" value={money(f.outstandingCents)} tone={f.outstandingCents > 0 ? 'warn' : undefined} />
        <Stat label="Open tasks" value={project.counts.openTasks} />
        <Stat label="Overdue" value={project.counts.overdueTasks} tone={project.counts.overdueTasks ? 'danger' : 'ok'} />
      </div>
      <div className="card-grid">
        <Card title="Quick actions">
          <div className="row wrap">
            {session.has('daily_logs.write') && <Button icon="log" onClick={() => navigate(`/projects/${project.id}/daily-logs?new=1`)}>Daily log</Button>}
            {session.has('documents.write') && <Button icon="camera" onClick={() => navigate(`/projects/${project.id}/documents?capture=1`)}>Add photo</Button>}
            {session.has('tasks.write') && <Button icon="tasks" onClick={() => navigate(`/projects/${project.id}/tasks?new=1`)}>New task</Button>}
            {session.has('messages.write') && <Button icon="messages" onClick={() => navigate(`/projects/${project.id}/messages?new=1`)}>New thread</Button>}
          </div>
        </Card>
        <Card title="Details">
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt className="muted">Client</dt><dd style={{ margin: 0 }}>{project.clientId ? <a onClick={() => navigate(`/clients/${project.clientId}`)}>{project.clientName}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Type</dt><dd style={{ margin: 0 }}>{project.type.replace('_', ' ')} · {project.contractType.replace(/_/g, ' ')}</dd></div>
            <div className="row-between"><dt className="muted">Start</dt><dd style={{ margin: 0 }}>{dateLong(project.startDate)}</dd></div>
            <div className="row-between"><dt className="muted">Target completion</dt><dd style={{ margin: 0 }}>{dateLong(project.targetEndDate)}</dd></div>
            <div className="row-between"><dt className="muted">Address</dt><dd style={{ margin: 0, textAlign: 'right' }}>{[project.address.line1, project.address.city, project.address.region].filter(Boolean).join(', ') || '—'}</dd></div>
          </dl>
          {project.description && <p className="mt-4 muted">{project.description}</p>}
        </Card>
        {schedule && <Card title="Schedule" actions={<a onClick={() => navigate(`/projects/${project.id}/schedule`)}>Open schedule</a>}>
          <div className="row-between mb-2"><span className="muted">{done} of {tasks.length} tasks complete</span><strong>{pct}%</strong></div>
          <Progress value={pct} />
          {schedule.conflicts.length > 0 && <div className="banner offline mt-2" style={{ borderRadius: 8 }}><Icon name="alert" size={16} />{schedule.conflicts.length} resource conflict{schedule.conflicts.length === 1 ? '' : 's'}</div>}
          {milestones.length > 0 && <div className="mt-4 stack-sm">{milestones.map((m) => <div key={m.id} className="row-between"><span className="row"><Icon name="flag" size={16} />{m.name}</span><span className="subtle">{dateShort(m.startDate)}</span></div>)}</div>}
          {upcoming.length > 0 && <div className="mt-4"><div className="subtle mb-2">Up next</div>{upcoming.map((t) => <div key={t.id} className="row-between" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}><span className="truncate">{t.name}</span><span className="subtle">{dateShort(t.startDate)} → {dateShort(t.endDate)}</span></div>)}</div>}
        </Card>}
        <Card title="Team" actions={<a onClick={() => navigate(`/projects/${project.id}/team`)}>Manage</a>}>
          <div className="stack-sm">{project.members.slice(0, 6).map((m) => <div key={m.id} className="row"><span className="avatar sm">{m.displayName.split(' ').map((s) => s[0]).join('')}</span><span className="grow truncate">{m.displayName}</span><Badge>{m.roleName ?? m.kind}</Badge></div>)}{project.members.length === 0 && <p className="muted">No one assigned yet.</p>}</div>
        </Card>
        {activity && <Card title="Recent activity" wide actions={<a onClick={() => navigate(`/projects/${project.id}/activity`)}>Full history</a>}>
          {activity.items.length === 0 ? <p className="muted">No activity yet.</p> : <div className="timeline">{activity.items.map((a) => <div key={a.id} className="timeline-item"><span className="avatar sm">{a.actorName.split(' ').map((s) => s[0]).join('')}</span><span>{a.summary}{a.clientVisible && <Badge tone="info" className="mt-2" style={{ marginLeft: 8 } as any}>client visible</Badge>}</span><span className="when">{timeAgo(a.occurredAt)}</span></div>)}</div>}
        </Card>}
      </div>
    </div>
  );
}
