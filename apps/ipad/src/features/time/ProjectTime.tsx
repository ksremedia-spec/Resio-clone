import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, Segmented, Select, Sheet, Skeleton, StatusBadge, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { CostCodeSelect, useCostCodes } from '../financial/shared';
import { ClockWidget, fmtDuration } from './ClockWidget';

export default function ProjectTime({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const manager = session.has('time.manage') || session.has('time.approve');
  const [scope, setScope] = useState<'mine' | 'all'>(manager ? 'all' : 'mine');
  const [status, setStatus] = useState<'all' | 'pending' | 'approved'>('all');
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.TimeEntry[] }>(`/v1/projects/${project.id}/time?status=${status}&limit=200${scope === 'mine' ? `&userId=${session.user?.id}` : ''}`);
  const items = data?.items ?? [];
  const totalSeconds = items.filter((e) => e.status !== 'rejected').reduce((n, e) => n + (e.durationSeconds ?? 0), 0);
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      {session.has('time.clock') && <Card title="Time clock"><ClockWidget projectId={project.id} /></Card>}
      <div className="row wrap">
        {manager && <Segmented value={scope} onChange={setScope} ariaLabel="Whose time" options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Mine' }]} />}
        <Segmented value={status} onChange={setStatus} ariaLabel="Time status" options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }]} />
        <span className="grow" />
        <span className="subtle">{fmtDuration(totalSeconds)} on this project</span>
        {session.has('time.clock') && <Button icon="plus" onClick={() => setParams({ new: '1' })}>Add time</Button>}
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
      {data && items.length === 0 && <EmptyState icon="clock" title="No time yet">Clock in above, or add time you forgot to record.</EmptyState>}
      {items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((e) => <TimeRow key={e.id} e={e} showUser={scope === 'all'} />)}</div></div>}
      {params.get('new') === '1' && <ManualTimeSheet projectId={project.id} onClose={() => setParams({})} onSaved={() => void refetch()} />}
    </div>
  );
}

export function TimeRow({ e, showUser, onClick, selected }: { e: contracts.TimeEntry; showUser?: boolean; onClick?: () => void; selected?: boolean }) {
  return <div className={`list-row ${selected ? 'selected' : ''}`} data-testid="time-row" onClick={onClick} role={onClick ? 'button' : undefined}>
    <Icon name={e.status === 'open' ? 'clock' : e.status === 'approved' || e.status === 'exported' ? 'checkCircle' : 'circle'} style={{ color: e.status === 'open' ? 'var(--brand)' : e.status === 'approved' ? 'var(--success)' : undefined }} />
    <span className="grow"><div className="primary">{showUser ? `${e.userName} · ` : ''}{dateShort(e.clockInAt)} · {new Date(e.clockInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{e.clockOutAt ? ` → ${new Date(e.clockOutAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ' → now'}</div><div className="secondary">{[e.projectName, e.costCode, e.breakSeconds ? `${Math.round(e.breakSeconds / 60)} min break` : '', e.notes].filter(Boolean).join(' · ')}</div></span>
    <span className="trailing"><strong className="mono">{e.status === 'open' ? '…' : fmtDuration(e.durationSeconds ?? 0)}</strong>{e.laborCostCents != null && e.status !== 'open' && <span className="subtle">{money(e.laborCostCents)}</span>}<StatusBadge status={e.status} /></span>
  </div>;
}

export function ManualTimeSheet({ projectId, onClose, onSaved }: { projectId?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const session = useSession();
  const { data: codes } = useCostCodes();
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>(!projectId ? '/v1/projects?status=open&limit=50' : null);
  const { data: members } = useResource<contracts.Member[]>(session.has('time.manage') ? '/v1/members' : null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ userId: '', projectId: projectId ?? '', costCodeId: null as string | null, date: today, start: '07:00', end: '15:30', breakMinutes: 30, notes: '' });
  const save = useApiMutation(() => { const clockInAt = new Date(`${form.date}T${form.start}:00`).toISOString(); const clockOutAt = new Date(`${form.date}T${form.end}:00`).toISOString(); return api.mutate<contracts.TimeEntry>('POST', '/v1/time/entries', { userId: form.userId || undefined, projectId: form.projectId || null, costCodeId: form.costCodeId, clockInAt, clockOutAt, breakSeconds: form.breakMinutes * 60, notes: form.notes }, { queue: { entity: 'time_entry', label: 'Add time entry', optimistic: null, invalidates: ['/v1/time'] } }); }, ['/v1/time', '/v1/projects', '/v1/budget']);
  return <Sheet open onClose={onClose} title="Add time" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (form.end <= form.start) { toast({ message: 'End must be after start.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: r.queued ? 'Saved on this iPad; it will sync when online.' : 'Time added for approval.', tone: r.queued ? undefined : 'success' }); onClose(); onSaved(); } catch (e) { errorToast(e); } }}>Save</Button></>}>
    <div className="form-grid">
      {members && <Field label="Team member" className="full"><Select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Me</option>{members.filter((m) => m.status === 'active').map((m) => <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName}</option>)}</Select></Field>}
      {!projectId && <Field label="Project" className="full"><Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">No project</option>{projects?.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></Field>}
      <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
      <Field label="Cost code"><CostCodeSelect value={form.costCodeId} onChange={(id) => setForm({ ...form, costCodeId: id })} codes={codes} /></Field>
      <Field label="Start"><Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
      <Field label="End"><Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
      <Field label="Break (minutes)"><Input type="number" min={0} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })} /></Field>
      <Field label="Notes" className="full"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Forgot to clock in" /></Field>
    </div>
    <p className="subtle"><Badge>Submitted</Badge> entries wait for a supervisor's approval before they count as labour cost. Added {dateTime(new Date().toISOString())}.</p>
  </Sheet>;
}
