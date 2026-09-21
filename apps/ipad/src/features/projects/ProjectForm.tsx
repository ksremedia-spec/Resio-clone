import { useState } from 'react';
import { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Button, Field, Input, Select, Sheet, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { parseMoneyInput } from '@buildline/core';

type ProjectLike = Partial<contracts.ProjectDetail>;

export function ProjectFormSheet({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project?: ProjectLike; onSaved: (p: contracts.ProjectDetail) => void }) {
  const editing = !!project?.id;
  const [form, setForm] = useState(() => ({
    name: project?.name ?? '', number: project?.number ?? '', status: project?.status ?? 'pre_construction', type: project?.type ?? 'remodel', contractType: project?.contractType ?? 'fixed_price',
    clientId: project?.clientId ?? '', line1: project?.address?.line1 ?? '', city: project?.address?.city ?? '', region: project?.address?.region ?? '', postalCode: project?.address?.postalCode ?? '',
    description: project?.description ?? '', startDate: project?.startDate ?? '', targetEndDate: project?.targetEndDate ?? '', contractValue: project?.contractValueCents != null ? (project.contractValueCents / 100).toFixed(2) : '',
    sharing: { clientCanSeeSchedule: true, clientCanSeeBudget: false, clientCanSeeDailyLogs: true, clientCanSeeDocuments: true, clientCanMessage: true, ...(project?.sharing ?? {}) },
  }));
  const { data: clients } = useResource<{ items: contracts.Client[] }>(open ? '/v1/clients?limit=200' : null);
  const toast = useToast();
  const errorToast = useErrorToast();
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const save = useApiMutation(async () => {
    let contractValueCents = 0;
    try { contractValueCents = form.contractValue ? parseMoneyInput(form.contractValue) : 0; } catch { throw new Error('Contract value must be a valid amount.'); }
    const body = { name: form.name.trim(), number: form.number.trim() || undefined, status: form.status, type: form.type, contractType: form.contractType, clientId: form.clientId || null, address: { line1: form.line1, city: form.city, region: form.region, postalCode: form.postalCode }, description: form.description, startDate: form.startDate || null, targetEndDate: form.targetEndDate || null, contractValueCents, sharing: form.sharing };
    return editing ? api.mutate<contracts.ProjectDetail>('PATCH', `/v1/projects/${project!.id}`, { ...body, expectedVersion: project!.version }) : api.mutate<contracts.ProjectDetail>('POST', '/v1/projects', body);
  }, ['/v1/projects', '/v1/dashboard']);
  const submit = async () => {
    if (!form.name.trim()) { toast({ message: 'Give the project a name.', tone: 'error' }); return; }
    try { const res = await save.mutateAsync(undefined); toast({ message: editing ? 'Project updated.' : `Project ${res.data.number} created.`, tone: 'success' }); onClose(); onSaved(res.data); }
    catch (err) { errorToast(err); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit project' : 'New project'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{editing ? 'Save' : 'Create project'}</Button></>}>
      <div className="form-grid">
        <Field label="Project name" className="full"><Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Smith Residence — Kitchen" /></Field>
        <Field label="Project number" hint={editing ? undefined : 'Leave blank to assign the next number.'}><Input value={form.number} onChange={(e) => set('number', e.target.value)} /></Field>
        <Field label="Client"><Select value={form.clientId} onChange={(e) => set('clientId', e.target.value)}><option value="">No client yet</option>{clients?.items.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</Select></Field>
        <Field label="Status"><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{contracts.PROJECT_STATUSES.filter((s) => s !== 'archived').map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Type"><Select value={form.type} onChange={(e) => set('type', e.target.value)}>{contracts.PROJECT_TYPES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Contract type"><Select value={form.contractType} onChange={(e) => set('contractType', e.target.value)}>{contracts.CONTRACT_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Field label="Contract value"><Input inputMode="decimal" value={form.contractValue} onChange={(e) => set('contractValue', e.target.value)} placeholder="0.00" /></Field>
        <Field label="Start date"><Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Target completion"><Input type="date" value={form.targetEndDate} onChange={(e) => set('targetEndDate', e.target.value)} /></Field>
        <Field label="Site address" className="full"><Input value={form.line1} onChange={(e) => set('line1', e.target.value)} placeholder="Street" /></Field>
        <Field label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Field label="State"><Input value={form.region} onChange={(e) => set('region', e.target.value)} /></Field><Field label="ZIP"><Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Field></div>
        <Field label="Description" className="full"><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="full stack-sm">
          <h4>Client portal sharing</h4>
          <Switch label="Schedule" checked={form.sharing.clientCanSeeSchedule} onChange={(v) => set('sharing', { ...form.sharing, clientCanSeeSchedule: v })} />
          <Switch label="Daily logs marked public" checked={form.sharing.clientCanSeeDailyLogs} onChange={(v) => set('sharing', { ...form.sharing, clientCanSeeDailyLogs: v })} />
          <Switch label="Shared documents" checked={form.sharing.clientCanSeeDocuments} onChange={(v) => set('sharing', { ...form.sharing, clientCanSeeDocuments: v })} />
          <Switch label="Budget summary" hint="Contract value, approved changes and payments only." checked={form.sharing.clientCanSeeBudget} onChange={(v) => set('sharing', { ...form.sharing, clientCanSeeBudget: v })} />
          <Switch label="Messaging" checked={form.sharing.clientCanMessage} onChange={(v) => set('sharing', { ...form.sharing, clientCanMessage: v })} />
        </div>
      </div>
    </Sheet>
  );
}
