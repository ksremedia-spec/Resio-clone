import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Sheet, Skeleton, StatusBadge, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { BudgetLineSelect, Money, MoneyInput } from '../financial/shared';

const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/selections', '/v1/approvals', '/v1/portal', '/v1/change-orders', '/v1/budget', '/v1/dashboard'];

export default function ProjectSelections({ project }: { project: contracts.ProjectDetail }) {
  const { selectionId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Selection[] }>(`/v1/projects/${project.id}/selections?status=all&limit=200`);
  const items = data?.items ?? [];
  const canWrite = session.has('selections.write');
  const portal = !!session.membership?.external;
  const groups: Array<[string, contracts.Selection[]]> = [
    [portal ? 'Waiting for your choice' : 'Waiting on the client', items.filter((s) => s.status === 'released')],
    ['Not yet released', items.filter((s) => s.status === 'pending')],
    ['Decided', items.filter((s) => s.status === 'decided')],
    ['Void', items.filter((s) => s.status === 'void')],
  ];
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <span className="muted">{portal ? 'Choices your builder needs from you. Prices over the allowance become a change order.' : 'Selections give the client priced options against an allowance. Releasing one asks them to decide in the portal.'}</span>
        <span className="grow" />
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New selection</Button>}
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
      {data && items.length === 0 && <EmptyState icon="layout" title="No selections" action={canWrite ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Add a selection</Button> : undefined}>{portal ? 'Nothing needs your decision right now.' : 'Tile, fixtures, paint, appliances: every choice the client makes, priced and tracked.'}</EmptyState>}
      {groups.filter(([, g]) => g.length).map(([label, g]) => <div key={label} className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="sidebar-section">{label} · {g.length}</div><div className="list">{g.map((s) => { const chosen = s.options.find((o) => o.id === s.selectedOptionId); return <button key={s.id} className="list-row" data-testid="selection-row" onClick={() => navigate(`/projects/${project.id}/selections/${s.id}`)}>
        <span className="grow"><div className="primary">{s.name}</div><div className="secondary">{[s.category, s.room].filter(Boolean).join(' · ')} · {s.options.length} option{s.options.length === 1 ? '' : 's'}{s.dueDate && s.status !== 'decided' ? ` · decide by ${dateShort(s.dueDate)}` : ''}{chosen ? ` · chose ${chosen.name}` : ''}</div></span>
        <span className="trailing">{s.overageCents > 0 && <Badge tone="warning">+{money(s.overageCents)} over</Badge>}<span className="subtle">allowance {money(s.allowanceCents)}</span><StatusBadge status={s.status} /><Icon name="chevronRight" size={16} /></span>
      </button>; })}</div></div>)}
      {params.get('new') === '1' && <SelectionSheet project={project} onClose={() => setParams({})} onSaved={(s) => navigate(`/projects/${project.id}/selections/${s.id}`)} />}
      {selectionId && <SelectionDetail project={project} selectionId={selectionId} onClose={() => navigate(`/projects/${project.id}/selections`)} />}
    </div>
  );
}

function SelectionDetail({ project, selectionId, onClose }: { project: contracts.ProjectDetail; selectionId: string; onClose: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: s, refetch } = useResource<contracts.Selection>(`/v1/selections/${selectionId}`);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [decidedByName, setDecidedByName] = useState('');
  const keys = [...inv(project.id), `/v1/selections/${selectionId}`];
  const release = useApiMutation(() => api.mutate('POST', `/v1/selections/${selectionId}/release`, {}), keys);
  const voidIt = useApiMutation(() => api.mutate('POST', `/v1/selections/${selectionId}/void`, {}), keys);
  const decide = useApiMutation((body: Record<string, unknown>) => api.mutate<contracts.Selection>('POST', `/v1/selections/${selectionId}/decide`, body), keys);
  if (!s) return <Sheet open onClose={onClose} title="Selection"><Skeleton lines={6} /></Sheet>;
  const canWrite = session.has('selections.write');
  const portal = !!session.membership?.external;
  const canDecide = s.status === 'released' || (!portal && canWrite && s.status === 'pending');
  const chosenOpt = s.options.find((o) => o.id === (picked ?? s.selectedOptionId));
  const overage = chosenOpt ? chosenOpt.priceCents - s.allowanceCents : 0;
  return <Sheet open onClose={onClose} title={s.name} size="lg" footer={<>
    {canWrite && s.status !== 'void' && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    <span className="grow" />
    {canWrite && s.status === 'pending' && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && s.status === 'pending' && <Button icon="send" onClick={() => release.mutateAsync(undefined).then(() => { toast({ message: 'Released to the client.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Release to client</Button>}
    {canDecide && <Button variant="primary" icon="check" disabled={!picked} onClick={() => setConfirming(true)}>{portal ? 'Confirm my choice' : 'Record choice'}</Button>}
    {s.changeOrderId && session.has('change_orders.read') && <Button variant="quiet" onClick={() => { onClose(); navigate(`/projects/${project.id}/change-orders/${s.changeOrderId}`); }}>Change order <Icon name="arrowRight" size={14} /></Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={s.status} /><Badge>{s.category}</Badge>{s.room && <Badge>{s.room}</Badge>}<span className="subtle">Allowance <strong className="mono">{money(s.allowanceCents)}</strong>{s.dueDate ? ` · decide by ${dateShort(s.dueDate)}` : ''}</span></div>
    {s.description && <p className="muted mb-4">{s.description}</p>}
    <div className="option-grid">{s.options.map((o) => { const selected = (picked ?? s.selectedOptionId) === o.id; const diff = o.priceCents - s.allowanceCents; return <button key={o.id} type="button" className={`option-card ${selected ? 'selected' : ''}`} disabled={!canDecide} aria-pressed={selected} data-testid="selection-option" onClick={() => setPicked(o.id)}>
      <div className="row-between"><strong>{o.name}</strong>{o.isRecommended && <Badge tone="brand">recommended</Badge>}{s.selectedOptionId === o.id && <Badge tone="success">chosen</Badge>}</div>
      <div className="subtle">{[o.manufacturer, o.model, o.finish].filter(Boolean).join(' · ')}</div>
      {o.description && <p className="muted" style={{ margin: '4px 0' }}>{o.description}</p>}
      <div className="row-between mt-2"><strong className="mono">{money(o.priceCents)}</strong>{diff === 0 ? <Badge tone="success">within allowance</Badge> : diff > 0 ? <Badge tone="warning">+{money(diff)} over allowance</Badge> : <Badge tone="success">{money(-diff)} under</Badge>}</div>
      {o.sourceUrl && <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="subtle" onClick={(e) => e.stopPropagation()}>Product page <Icon name="external" size={12} /></a>}
    </button>; })}</div>
    {s.approvals.length > 0 && <div className="stack-sm mt-4">{s.approvals.map((a) => <div key={a.id} className="row-between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}><span><StatusBadge status={a.status} /> {a.decidedByName ?? 'Awaiting client'}{a.decisionNote ? ` — “${a.decisionNote}”` : ''}</span><span className="subtle">{dateTime(a.decidedAt ?? a.requestedAt)}</span></div>)}</div>}
    {editing && <SelectionSheet project={project} selection={s} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    <Sheet open={confirming} onClose={() => setConfirming(false)} title={portal ? 'Confirm your choice' : 'Record the client\'s choice'} footer={<><Button onClick={() => setConfirming(false)}>Back</Button><Button variant="primary" loading={decide.isPending} onClick={async () => { if (!portal && !decidedByName.trim()) { toast({ message: 'Enter who decided.', tone: 'error' }); return; } try { const r = await decide.mutateAsync({ optionId: picked, ...(portal ? {} : { decidedByName: decidedByName.trim() }) }); toast({ message: r.data.changeOrderId ? 'Choice recorded. A change order was drafted for the amount over the allowance.' : 'Choice recorded.', tone: 'success' }); setConfirming(false); setPicked(null); void refetch(); } catch (e) { errorToast(e); } }}>Confirm</Button></>}>
      {chosenOpt && <div className="stack">
        <div className="row-between"><span>{chosenOpt.name}</span><strong className="mono">{money(chosenOpt.priceCents)}</strong></div>
        <div className="row-between"><span className="muted">Allowance</span><Money cents={s.allowanceCents} /></div>
        <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>{overage > 0 ? 'Added to your contract' : overage < 0 ? 'Credit against the allowance' : 'No change to the contract'}</span><strong className="mono" style={{ color: overage > 0 ? 'var(--warning)' : undefined }}>{overage > 0 ? `+${money(overage)}` : overage < 0 ? `−${money(-overage)}` : '$0.00'}</strong></div>
        {overage > 0 && <p className="subtle">{portal ? 'Your builder will send a change order for this amount for you to approve.' : 'A draft change order for this amount is created for you to send.'}</p>}
        {!portal && <Field label="Decided by"><Input value={decidedByName} onChange={(e) => setDecidedByName(e.target.value)} placeholder="Jane Smith" autoFocus /></Field>}
      </div>}
    </Sheet>
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this selection?" confirmLabel="Void" message="It is removed from the client's list. Any change order already created stays as it is." onConfirm={async () => { try { await voidIt.mutateAsync(undefined); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

type OptionDraft = { id?: string; name: string; description: string; manufacturer: string; model: string; costCents: number; priceCents: number; sourceUrl: string; isRecommended: boolean };
const emptyOption = (): OptionDraft => ({ name: '', description: '', manufacturer: '', model: '', costCents: 0, priceCents: 0, sourceUrl: '', isRecommended: false });

function SelectionSheet({ project, selection, onClose, onSaved }: { project: contracts.ProjectDetail; selection?: contracts.Selection; onClose: () => void; onSaved: (s: contracts.Selection) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: budget } = useResource<contracts.Budget>(`/v1/projects/${project.id}/budget`);
  const [form, setForm] = useState({ category: selection?.category ?? '', room: selection?.room ?? '', name: selection?.name ?? '', description: selection?.description ?? '', allowanceCents: selection?.allowanceCents ?? 0, dueDate: selection?.dueDate ?? '', budgetLineId: selection?.budgetLineId ?? null });
  const [options, setOptions] = useState<OptionDraft[]>(selection ? selection.options.map((o) => ({ id: o.id, name: o.name, description: o.description, manufacturer: o.manufacturer ?? '', model: o.model ?? '', costCents: o.costCents, priceCents: o.priceCents, sourceUrl: o.sourceUrl ?? '', isRecommended: o.isRecommended })) : [emptyOption(), emptyOption()]);
  const setOpt = (i: number, patch: Partial<OptionDraft>) => setOptions(options.map((o, j) => j === i ? { ...o, ...patch } : o));
  const save = useApiMutation(() => { const body = { ...form, room: form.room || null, dueDate: form.dueDate || null, options: options.filter((o) => o.name.trim()).map((o) => ({ ...o, manufacturer: o.manufacturer || null, model: o.model || null, sourceUrl: o.sourceUrl || null })) }; return selection ? api.mutate<contracts.Selection>('PATCH', `/v1/selections/${selection.id}`, body) : api.mutate<contracts.Selection>('POST', `/v1/projects/${project.id}/selections`, body); }, [...inv(project.id), ...(selection ? [`/v1/selections/${selection.id}`] : [])]);
  return <Sheet open onClose={onClose} title={selection ? 'Edit selection' : 'New selection'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim() || !form.category.trim()) { toast({ message: 'Enter a category and a name.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: selection ? 'Selection updated.' : 'Selection created.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{selection ? 'Save' : 'Create'}</Button></>}>
    <div className="form-grid">
      <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} autoFocus placeholder="Tile" list="selection-categories" /><datalist id="selection-categories">{['Tile', 'Plumbing fixtures', 'Lighting', 'Appliances', 'Countertops', 'Cabinet hardware', 'Paint', 'Flooring', 'Doors & hardware'].map((c) => <option key={c} value={c} />)}</datalist></Field>
      <Field label="Room"><Input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Primary bath" /></Field>
      <Field label="Name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Shower floor tile" /></Field>
      <Field label="Allowance" hint="What the contract already includes for this item."><MoneyInput value={form.allowanceCents} onChange={(v) => setForm({ ...form, allowanceCents: v })} aria-label="Allowance" /></Field>
      <Field label="Decide by"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      <Field label="Budget line" className="full"><BudgetLineSelect value={form.budgetLineId} onChange={(id) => setForm({ ...form, budgetLineId: id })} lines={budget?.lines} /></Field>
      <Field label="Notes for the client" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </div>
    <h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Options</h3>
    <div className="line-editor">
      {options.map((o, i) => <div key={o.id ?? i} className="line" data-testid="option-editor">
        <div className="row"><Input value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} placeholder="Option name" aria-label="Option name" className="grow" /><Button variant="quiet" icon="trash" aria-label="Remove option" onClick={() => setOptions(options.filter((_, j) => j !== i))} /></div>
        <div className="fields">
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Manufacturer</span><Input value={o.manufacturer} onChange={(e) => setOpt(i, { manufacturer: e.target.value })} /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Model</span><Input value={o.model} onChange={(e) => setOpt(i, { model: e.target.value })} /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Our cost</span><MoneyInput value={o.costCents} onChange={(v) => setOpt(i, { costCents: v })} aria-label="Our cost" /></label>
          <label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Client price</span><MoneyInput value={o.priceCents} onChange={(v) => setOpt(i, { priceCents: v })} aria-label="Client price" /></label>
        </div>
        <div className="fields"><label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Product link</span><Input value={o.sourceUrl} onChange={(e) => setOpt(i, { sourceUrl: e.target.value })} placeholder="https://" /></label><label className="stack-sm" style={{ gap: 4 }}><span className="subtle">Description</span><Input value={o.description} onChange={(e) => setOpt(i, { description: e.target.value })} /></label></div>
        <Switch label="Recommended" checked={o.isRecommended} onChange={(v) => setOpt(i, { isRecommended: v })} />
      </div>)}
      <div><Button icon="plus" onClick={() => setOptions([...options, emptyOption()])}>Add option</Button></div>
    </div>
  </Sheet>;
}
