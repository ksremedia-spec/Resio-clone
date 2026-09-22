import { useState } from 'react';
import { contracts } from '@buildline/core';
import { z } from 'zod';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Icon, Input, Select, Sheet, Skeleton, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateTime, humanize, timeAgo } from '../../ui/format';

type Catalog = z.infer<typeof contracts.automationCatalog>;
type Action = contracts.AutomationAction;
type Draft = { name: string; description: string; trigger: { event: contracts.AutomationEvent; projectId: string | null }; actions: Action[]; enabled: boolean };

const ACTION_LABELS: Record<Action['type'], string> = { notify: 'Send an in-app notification', create_task: 'Create a to-do', email: 'Send an email' };
const TO_LABELS: Record<string, string> = { project_team: 'Everyone on the project', project_managers: 'The project managers', role: 'Everyone with a role…', actor: 'The person who did it', nobody: 'Nobody', client: "The project's client", address: 'A specific address…' };
const blank = (): Draft => ({ name: '', description: '', trigger: { event: 'daily_log.posted', projectId: null }, actions: [{ type: 'notify', to: 'project_team', title: '', body: '{{summary}}' }], enabled: true });

/** Settings → Automations: "when this happens, do that", with a run log so nothing is a mystery. */
export default function AutomationsSettings() {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: list, isLoading, refetch } = useResource<contracts.Automation[]>('/v1/automations');
  const { data: catalog } = useResource<Catalog>('/v1/automations/catalog');
  const { data: runs, refetch: refetchRuns } = useResource<{ items: contracts.AutomationRun[] }>('/v1/automations/runs?limit=25');
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<contracts.Automation | null>(null);
  const toggle = useApiMutation((a: contracts.Automation) => api.mutate('PATCH', `/v1/automations/${a.id}`, { enabled: !a.enabled }), ['/v1/automations']);
  const remove = useApiMutation((id: string) => api.mutate('DELETE', `/v1/automations/${id}`), ['/v1/automations']);
  const runNow = useApiMutation(() => api.mutate<{ evaluated: number; fired: number }>('POST', '/v1/automations/run-scheduled'), ['/v1/automations', '/v1/tasks', '/v1/projects', '/v1/notifications', '/v1/dashboard']);
  const fromTemplate = (t: Catalog['templates'][number]) => setEditing({ draft: { name: t.name, description: t.description, trigger: { ...t.trigger }, actions: t.actions.map((a) => ({ ...a })), enabled: true } });
  return <div className="stack" style={{ maxWidth: 900 }}>
    <div className="row-between wrap"><div><h2>Automations</h2><p className="muted">Small rules that do the routine follow-ups for you. Each one runs as the system and shows up in the activity feed.</p></div><Button variant="primary" icon="plus" onClick={() => setEditing({ draft: blank() })} data-testid="new-automation">New automation</Button></div>
    {isLoading && !list && <Skeleton lines={4} />}
    {list && list.length === 0 && <EmptyState icon="refresh" title="No automations yet">Start from one of the ready-made rules below, or build your own.</EmptyState>}
    {list && list.length > 0 && <div className="list card" style={{ padding: 0, overflow: 'hidden' }}>{list.map((a) => <div key={a.id} className="list-row" style={{ alignItems: 'flex-start' }} data-testid="automation-row">
      <span className="grow">
        <div className="primary row wrap">{a.name}{!a.enabled && <Badge tone="warning">Paused</Badge>}{a.projectName && <Badge>{a.projectName}</Badge>}</div>
        <div className="secondary">When {catalog?.events.find((e) => e.key === a.trigger.event)?.label.toLowerCase() ?? humanize(a.trigger.event)} → {a.actions.map((x) => ACTION_LABELS[x.type].toLowerCase()).join(', ')}</div>
        <div className="subtle">{a.runCount ?? 0} run{a.runCount === 1 ? '' : 's'}{a.lastRunAt ? ` · last ${timeAgo(a.lastRunAt)}` : ''}</div>
      </span>
      <span className="trailing row">
        <Switch label="" checked={a.enabled} onChange={() => toggle.mutateAsync(a).then(() => toast({ message: a.enabled ? 'Paused.' : 'Resumed.' })).catch(errorToast)} />
        <Button size="sm" variant="quiet" icon="edit" aria-label="Edit" onClick={() => setEditing({ id: a.id, draft: { name: a.name, description: a.description, trigger: { ...a.trigger }, actions: a.actions.map((x) => ({ ...x })), enabled: a.enabled } })} />
        <Button size="sm" variant="quiet" icon="trash" aria-label="Delete" onClick={() => setDeleting(a)} />
      </span>
    </div>)}</div>}
    <Card title="Daily check" actions={<Button size="sm" icon="refresh" loading={runNow.isPending} data-testid="run-scheduled" onClick={() => runNow.mutateAsync(undefined).then((r) => { toast({ message: r.data.fired ? `Ran ${r.data.fired} automation${r.data.fired === 1 ? '' : 's'}.` : 'Nothing new to act on.', tone: 'success' }); void refetchRuns(); void refetch(); }).catch(errorToast)}>Run now</Button>}>
      <p className="muted">Overdue invoices, overdue to-dos and lead follow-ups are checked every hour on the server. Tap <strong>Run now</strong> to check immediately. Each item triggers an automation once.</p>
    </Card>
    {catalog && <Card title="Ready-made rules">
      <div className="card-grid">{catalog.templates.map((t) => <button key={t.key} type="button" className="kanban-card" onClick={() => fromTemplate(t)} data-testid="automation-template"><strong>{t.name}</strong><span className="subtle">{t.description}</span></button>)}</div>
    </Card>}
    <Card title="Recent runs">
      {!runs ? <Skeleton lines={3} /> : runs.items.length === 0 ? <p className="muted">Nothing has run yet.</p> : <div className="timeline">{runs.items.map((r) => <div key={r.id} className="timeline-item" data-testid="automation-run">
        <span className={`dot ${r.status === 'succeeded' ? 'brand' : ''}`} style={r.status === 'failed' ? { background: 'var(--danger)' } : undefined} />
        <div className="grow"><div className="row wrap"><strong>{r.automationName}</strong><Badge tone={r.status === 'succeeded' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>{humanize(r.status)}</Badge><span className="subtle">{dateTime(r.startedAt)}</span></div><div className="subtle">{r.input.summary}</div>{r.output && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{r.output.map((o, i) => <li key={i} className="subtle">{humanize(o.action)}: {o.result}</li>)}</ul>}{r.error && <div className="text-warning">{r.error}</div>}</div>
      </div>)}</div>}
    </Card>
    {editing && catalog && <AutomationEditor id={editing.id} draft={editing.draft} catalog={catalog} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refetch(); }} />}
    <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title={`Delete "${deleting?.name}"?`} message="It stops running immediately. Its past runs stay in the activity feed." confirmLabel="Delete" danger onConfirm={async () => { await remove.mutateAsync(deleting!.id); setDeleting(null); toast({ message: 'Deleted.' }); }} />
  </div>;
}

function AutomationEditor({ id, draft, catalog, onClose, onSaved }: { id?: string; draft: Draft; catalog: Catalog; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [d, setD] = useState<Draft>(draft);
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>('/v1/projects?status=open&limit=100');
  const { data: roles } = useResource<contracts.Role[]>('/v1/roles');
  const save = useApiMutation(() => id ? api.mutate<contracts.Automation>('PATCH', `/v1/automations/${id}`, d) : api.mutate<contracts.Automation>('POST', '/v1/automations', d), ['/v1/automations']);
  const setAction = (i: number, a: Action) => setD({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) });
  const valid = d.name.trim().length > 0 && d.actions.length > 0 && d.actions.every((a) => (a.type === 'notify' ? a.title.trim() && (a.to !== 'role' || a.roleKey) : a.type === 'create_task' ? a.name.trim() : a.subject.trim() && (a.to !== 'address' || a.address)));
  const scheduled = catalog.events.find((e) => e.key === d.trigger.event)?.scheduled;
  return <Sheet open onClose={onClose} title={id ? 'Edit automation' : 'New automation'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!valid} data-testid="save-automation" onClick={() => save.mutateAsync(undefined).then(() => { toast({ message: id ? 'Automation updated.' : 'Automation created.', tone: 'success' }); onSaved(); }).catch(errorToast)}>{id ? 'Save' : 'Create'}</Button></>}>
    <div className="stack">
      <Field label="Name"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Invoice overdue → follow up" data-testid="automation-name" /></Field>
      <Card title="When">
        <div className="rule-row">
          <span className="label">Event</span><Select value={d.trigger.event} onChange={(e) => setD({ ...d, trigger: { ...d.trigger, event: e.target.value as contracts.AutomationEvent } })} aria-label="Event">{catalog.events.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</Select>
          <span className="label">Project</span><Select value={d.trigger.projectId ?? ''} onChange={(e) => setD({ ...d, trigger: { ...d.trigger, projectId: e.target.value || null } })} aria-label="Project"><option value="">Any project</option>{projects?.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select>
        </div>
        {scheduled && <p className="subtle mt-2">Checked hourly; each overdue item triggers this once.</p>}
      </Card>
      <Card title="Then" actions={<Select value="" onChange={(e) => { const t = e.target.value as Action['type']; if (!t) return; const a: Action = t === 'notify' ? { type: 'notify', to: 'project_team', title: '', body: '{{summary}}' } : t === 'create_task' ? { type: 'create_task', name: '', description: '{{summary}}', daysUntilDue: 1, priority: 'medium', assignTo: 'project_managers' } : { type: 'email', to: 'client', subject: '', body: '' }; setD({ ...d, actions: [...d.actions, a] }); }} aria-label="Add action"><option value="">+ Add action</option><option value="notify">Notification</option><option value="create_task">To-do</option><option value="email">Email</option></Select>}>
        <div className="stack">{d.actions.map((a, i) => <div key={i} className="card" style={{ background: 'var(--bg-sunken)' }}>
          <div className="row-between"><strong>{ACTION_LABELS[a.type]}</strong>{d.actions.length > 1 && <Button size="sm" variant="quiet" icon="trash" aria-label="Remove action" onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })} />}</div>
          <div className="rule-row mt-2">
            {a.type === 'notify' && <>
              <span className="label">To</span><Select value={a.to} onChange={(e) => setAction(i, { ...a, to: e.target.value as any })}>{['project_team', 'project_managers', 'role', 'actor'].map((k) => <option key={k} value={k}>{TO_LABELS[k]}</option>)}</Select>
              {a.to === 'role' && <><span className="label">Role</span><Select value={a.roleKey ?? ''} onChange={(e) => setAction(i, { ...a, roleKey: e.target.value })}><option value="">Choose a role</option>{roles?.filter((r) => r.key).map((r) => <option key={r.id} value={r.key!}>{r.name}</option>)}</Select></>}
              <span className="label">Title</span><Input value={a.title} onChange={(e) => setAction(i, { ...a, title: e.target.value })} placeholder="Daily log posted on {{project}}" />
              <span className="label">Message</span><Textarea rows={2} value={a.body} onChange={(e) => setAction(i, { ...a, body: e.target.value })} />
            </>}
            {a.type === 'create_task' && <>
              <span className="label">To-do</span><Input value={a.name} onChange={(e) => setAction(i, { ...a, name: e.target.value })} placeholder="Follow up on {{object}}" />
              <span className="label">Details</span><Textarea rows={2} value={a.description} onChange={(e) => setAction(i, { ...a, description: e.target.value })} />
              <span className="label">Due in</span><div className="row"><Input type="number" min={0} max={365} value={a.daysUntilDue} onChange={(e) => setAction(i, { ...a, daysUntilDue: Math.max(0, Number(e.target.value) || 0) })} style={{ maxWidth: 90 }} /><span className="subtle">days</span><Select value={a.priority} onChange={(e) => setAction(i, { ...a, priority: e.target.value as any })} style={{ maxWidth: 140 }}><option value="low">Low priority</option><option value="medium">Medium priority</option><option value="high">High priority</option></Select></div>
              <span className="label">Assign to</span><Select value={a.assignTo} onChange={(e) => setAction(i, { ...a, assignTo: e.target.value as any })}>{['project_managers', 'project_team', 'role', 'actor', 'nobody'].map((k) => <option key={k} value={k}>{TO_LABELS[k]}</option>)}</Select>
              {a.assignTo === 'role' && <><span className="label">Role</span><Select value={a.roleKey ?? ''} onChange={(e) => setAction(i, { ...a, roleKey: e.target.value })}><option value="">Choose a role</option>{roles?.filter((r) => r.key).map((r) => <option key={r.id} value={r.key!}>{r.name}</option>)}</Select></>}
            </>}
            {a.type === 'email' && <>
              <span className="label">To</span><Select value={a.to} onChange={(e) => setAction(i, { ...a, to: e.target.value as any })}>{['client', 'actor', 'address'].map((k) => <option key={k} value={k}>{TO_LABELS[k]}</option>)}</Select>
              {a.to === 'address' && <><span className="label">Address</span><Input type="email" value={a.address ?? ''} onChange={(e) => setAction(i, { ...a, address: e.target.value })} /></>}
              <span className="label">Subject</span><Input value={a.subject} onChange={(e) => setAction(i, { ...a, subject: e.target.value })} />
              <span className="label">Body</span><Textarea rows={4} value={a.body} onChange={(e) => setAction(i, { ...a, body: e.target.value })} />
            </>}
          </div>
        </div>)}</div>
        <p className="subtle mt-2"><Icon name="info" size={12} /> You can use {catalog.placeholders.map((p) => p.key).join(', ')} in any text.</p>
      </Card>
      <Field label="Notes (optional)"><Textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
      <Switch label="Enabled" checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} />
    </div>
  </Sheet>;
}
