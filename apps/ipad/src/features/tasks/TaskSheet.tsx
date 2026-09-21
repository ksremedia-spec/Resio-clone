import { useEffect, useState } from 'react';
import { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, Field, Input, Select, Sheet, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { useSession } from '../../store/session';
import { dateShort, todayIso } from '../../ui/format';

/** Create/edit sheet for schedule tasks and to-dos. Works offline: creates are queued with a client id. */
export function TaskSheet({ projectId, task, defaults, onClose, onSaved }: { projectId: string; task?: contracts.Task | null; defaults?: Partial<{ kind: 'schedule' | 'todo'; phaseId: string | null; startDate: string }>; onClose: () => void; onSaved?: (t: contracts.Task) => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const editing = !!task;
  const kind = task?.kind ?? defaults?.kind ?? 'schedule';
  const [form, setForm] = useState({
    name: task?.name ?? '', description: task?.description ?? '', status: task?.status ?? 'not_started', priority: task?.priority ?? 'medium', phaseId: task?.phaseId ?? defaults?.phaseId ?? '',
    isMilestone: task?.isMilestone ?? false, startDate: task?.startDate ?? defaults?.startDate ?? todayIso(), durationDays: task?.durationDays ?? 1, dueDate: task?.dueDate ?? '', clientVisible: task?.clientVisible ?? kind === 'schedule',
    assignees: new Set(task?.assignees.filter((a) => a.userId).map((a) => a.userId!) ?? []), checklist: task?.checklist.map((c) => ({ id: c.id as string | undefined, text: c.text, done: c.done })) ?? [], newItem: '',
    predecessorId: '', predecessorType: 'FS' as string, lagDays: 0, percentComplete: task?.percentComplete ?? 0,
  });
  const { data: members } = useResource<contracts.Member[]>(session.has('projects.read') ? '/v1/members' : null);
  const { data: phases } = useResource<contracts.Phase[]>(kind === 'schedule' ? `/v1/projects/${projectId}/phases` : null);
  const { data: siblings } = useResource<{ items: contracts.Task[] }>(kind === 'schedule' ? `/v1/projects/${projectId}/tasks?status=all&kind=schedule&limit=200` : null);
  const [removing, setRemoving] = useState(false);
  const canEditDetails = kind === 'todo' ? session.has('tasks.write') : session.has('schedule.write');
  const save = useApiMutation(async () => {
    const base = { name: form.name.trim(), description: form.description, status: form.status, priority: form.priority, phaseId: form.phaseId || null, isMilestone: form.isMilestone, clientVisible: form.clientVisible, assigneeUserIds: [...form.assignees], dueDate: form.dueDate || null, ...(kind === 'schedule' ? { startDate: form.startDate || null, durationDays: form.isMilestone ? 0 : Number(form.durationDays) } : {}) };
    if (editing) {
      const body = canEditDetails ? { ...base, percentComplete: form.percentComplete, checklist: form.checklist, expectedVersion: task!.version } : { status: form.status, percentComplete: form.percentComplete, checklist: form.checklist, expectedVersion: task!.version };
      return api.mutate<contracts.Task>('PATCH', `/v1/tasks/${task!.id}`, body, { queue: { entity: 'task', label: `Update task "${form.name}"`, optimistic: { ...task!, ...base, checklist: form.checklist }, invalidates: [`/v1/projects/${projectId}`, '/v1/tasks', '/v1/dashboard'] } });
    }
    const id = crypto.randomUUID();
    const body = { ...base, id, kind, checklist: form.checklist.map((c) => c.text), predecessors: form.predecessorId ? [{ taskId: form.predecessorId, type: form.predecessorType, lagDays: Number(form.lagDays) }] : undefined, clientMutationId: crypto.randomUUID() };
    return api.mutate<contracts.Task>('POST', `/v1/projects/${projectId}/tasks`, body, { queue: { entity: 'task', label: `Create task "${form.name}"`, optimistic: { id, projectId, ...base, kind, version: 1, assignees: [], predecessors: [], successors: [], checklist: [], attachmentCount: 0, endDate: form.startDate, sortOrder: 0, locked: false, color: null, costCodeId: null, completedAt: null, parentTaskId: null, organizationId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: null, updatedBy: null }, invalidates: [`/v1/projects/${projectId}`, '/v1/tasks', '/v1/dashboard'] } });
  }, [`/v1/projects/${projectId}`, '/v1/tasks', '/v1/dashboard']);
  const remove = useApiMutation(() => api.mutate('DELETE', `/v1/tasks/${task!.id}`), [`/v1/projects/${projectId}`, '/v1/tasks', '/v1/dashboard']);
  useEffect(() => { if (form.status === 'complete' && form.percentComplete !== 100) setForm((f) => ({ ...f, percentComplete: 100 })); }, [form.status]);
  const submit = async () => {
    if (!form.name.trim()) { toast({ message: 'Give the task a name.', tone: 'error' }); return; }
    try { const r = await save.mutateAsync(undefined); toast({ message: r.queued ? 'Saved on this iPad; it will sync when online.' : editing ? 'Task updated.' : 'Task created.', tone: r.queued ? undefined : 'success' }); onClose(); onSaved?.(r.data); }
    catch (e) { errorToast(e); }
  };
  return (
    <Sheet open onClose={onClose} title={editing ? task!.name : kind === 'todo' ? 'New to-do' : 'New task'} size="lg" footer={<>{editing && canEditDetails && <Button variant="danger" onClick={() => setRemoving(true)}>Delete</Button>}<span className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{editing ? 'Save' : 'Create'}</Button></>}>
      {editing && !canEditDetails && <div className="banner syncing mb-4" style={{ borderRadius: 8 }}>You can update progress, status and the checklist on tasks assigned to you.</div>}
      <div className="form-grid">
        <Field label="Name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={!editing} disabled={editing && !canEditDetails} placeholder={kind === 'todo' ? 'Order pot filler' : 'Frame second floor'} /></Field>
        <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>{contracts.TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as any })} disabled={editing && !canEditDetails}>{contracts.TASK_PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        {kind === 'schedule' && <>
          <Field label="Phase"><Select value={form.phaseId} onChange={(e) => setForm({ ...form, phaseId: e.target.value })} disabled={editing && !canEditDetails}><option value="">No phase</option>{phases?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Start"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} disabled={editing && !canEditDetails} /></Field>
          <Field label={form.isMilestone ? 'Milestone' : 'Duration (working days)'}><Input type="number" min={1} value={form.isMilestone ? 0 : form.durationDays} disabled={form.isMilestone || (editing && !canEditDetails)} onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} /></Field>
          <div className="stack-sm"><Switch label="Milestone" checked={form.isMilestone} onChange={(v) => setForm({ ...form, isMilestone: v })} /><Switch label="Visible to client" checked={form.clientVisible} onChange={(v) => setForm({ ...form, clientVisible: v })} /></div>
          {!editing && <Field label="Depends on" className="full" hint="The task will start after this one finishes (plus any lag).">
            <div className="row"><Select value={form.predecessorId} onChange={(e) => setForm({ ...form, predecessorId: e.target.value })}><option value="">No dependency</option>{siblings?.items.map((t) => <option key={t.id} value={t.id}>{t.name} ({dateShort(t.endDate)})</option>)}</Select>
              {form.predecessorId && <><Select value={form.predecessorType} onChange={(e) => setForm({ ...form, predecessorType: e.target.value })} style={{ width: 200 }}><option value="FS">Finish → Start</option><option value="SS">Start → Start</option><option value="FF">Finish → Finish</option></Select><Input type="number" style={{ width: 110 }} value={form.lagDays} onChange={(e) => setForm({ ...form, lagDays: Number(e.target.value) })} aria-label="Lag days" /></>}</div>
          </Field>}
        </>}
        {kind === 'todo' && <Field label="Due date"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} disabled={editing && !canEditDetails} /></Field>}
        {editing && <Field label="Progress %"><Input type="number" min={0} max={100} value={form.percentComplete} onChange={(e) => setForm({ ...form, percentComplete: Number(e.target.value) })} /></Field>}
        <Field label="Assignees" className="full"><div className="row wrap">{members?.filter((m) => m.status === 'active').map((m) => <button key={m.userId} type="button" className={`chip ${form.assignees.has(m.userId) ? 'on' : ''}`} aria-pressed={form.assignees.has(m.userId)} disabled={editing && !canEditDetails} onClick={() => { const s = new Set(form.assignees); if (s.has(m.userId)) s.delete(m.userId); else s.add(m.userId); setForm({ ...form, assignees: s }); }}>{m.firstName} {m.lastName}</button>)}</div></Field>
        <Field label="Description" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={editing && !canEditDetails} /></Field>
        <Field label="Checklist" className="full">
          <div className="stack-sm">
            {form.checklist.map((c, i) => <label key={c.id ?? i} className="row" style={{ minHeight: 40 }}><input type="checkbox" checked={c.done} onChange={(e) => setForm({ ...form, checklist: form.checklist.map((x, j) => j === i ? { ...x, done: e.target.checked } : x) })} /><span className="grow" style={{ textDecoration: c.done ? 'line-through' : undefined }}>{c.text}</span><Button size="sm" variant="quiet" icon="close" aria-label="Remove item" onClick={() => setForm({ ...form, checklist: form.checklist.filter((_, j) => j !== i) })} /></label>)}
            <div className="row"><Input placeholder="Add checklist item" value={form.newItem} onChange={(e) => setForm({ ...form, newItem: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && form.newItem.trim()) { e.preventDefault(); setForm({ ...form, checklist: [...form.checklist, { id: undefined, text: form.newItem.trim(), done: false }], newItem: '' }); } }} /><Button onClick={() => { if (form.newItem.trim()) setForm({ ...form, checklist: [...form.checklist, { id: undefined, text: form.newItem.trim(), done: false }], newItem: '' }); }}>Add</Button></div>
          </div>
        </Field>
        {editing && task!.predecessors.length > 0 && <div className="full"><div className="subtle mb-2">Depends on</div><div className="row wrap">{task!.predecessors.map((d) => <Badge key={d.id}>{siblings?.items.find((t) => t.id === d.predecessorId)?.name ?? 'task'} · {d.type}{d.lagDays ? ` +${d.lagDays}d` : ''}</Badge>)}</div></div>}
      </div>
      <ConfirmDialog open={removing} onClose={() => setRemoving(false)} danger title="Delete task?" confirmLabel="Delete" message="The task is archived and removed from the schedule; dependencies on it are cleared. History is kept in the activity log." onConfirm={async () => { try { await remove.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); throw e; } }} />
    </Sheet>
  );
}
