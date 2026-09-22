import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Progress, Select, Sheet, Skeleton, StatusBadge, Switch, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateShort, dateTime, money, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { BudgetLineSelect, Money, MoneyInput } from '../financial/shared';

const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/selections', '/v1/approvals', '/v1/portal', '/v1/change-orders', '/v1/budget', '/v1/dashboard'];
const isPriced = (s: contracts.Selection) => s.options.some((o) => o.priceCents > 0) || s.allowanceCents > 0;

export default function ProjectSelections({ project }: { project: contracts.ProjectDetail }) {
  const { selectionId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Selection[] }>(`/v1/projects/${project.id}/selections?status=all&limit=200`);
  const items = data?.items ?? [];
  const canWrite = session.has('selections.write');
  const portal = !!session.membership?.external;
  const sheetItems = items.filter((s) => s.templateKey && s.status !== 'void');
  const decided = sheetItems.filter((s) => s.status === 'decided').length;
  const groups: Array<[string, contracts.Selection[]]> = [
    [portal ? 'Waiting for your choice' : 'Waiting on the client', items.filter((s) => s.status === 'released')],
    ['Not yet released', items.filter((s) => s.status === 'pending')],
    ['Decided', items.filter((s) => s.status === 'decided')],
    ['Void', items.filter((s) => s.status === 'void')],
  ];
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <span className="muted">{portal ? 'Choices your builder needs from you. Priced options over the allowance become a change order.' : 'Everything the client chooses, in one place: the standard sheet plus any priced selections against an allowance.'}</span>
        <span className="grow" />
        {items.length > 0 && <Button icon="file" onClick={() => navigate(`/projects/${project.id}/selections/sheet`)} data-testid="open-sheet">Selections sheet</Button>}
        {canWrite && <Button icon="layout" onClick={() => setParams({ template: '1' })} data-testid="add-template">Add standard sheet</Button>}
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New selection</Button>}
      </div>
      {sheetItems.length > 0 && <div className="card" data-testid="sheet-banner">
        <div className="row-between wrap"><div><strong>Selections sheet</strong><div className="subtle">{decided} of {sheetItems.length} decided{portal ? ' · tap an item below to make your choice, then sign the sheet' : ''}</div></div><Button size="sm" variant="primary" onClick={() => navigate(`/projects/${project.id}/selections/sheet`)}>Open sheet</Button></div>
        <Progress value={sheetItems.length ? (decided / sheetItems.length) * 100 : 0} />
      </div>}
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
      {data && items.length === 0 && <EmptyState icon="layout" title="No selections" action={canWrite ? <div className="row"><Button variant="primary" onClick={() => setParams({ template: '1' })}>Add the standard sheet</Button><Button onClick={() => setParams({ new: '1' })}>Add one selection</Button></div> : undefined}>{portal ? 'Nothing needs your decision right now.' : 'Start from the standard selections sheet, or add priced options against an allowance one at a time.'}</EmptyState>}
      {groups.filter(([, g]) => g.length).map(([label, g]) => <div key={label} className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="sidebar-section">{label} · {g.length}</div><div className="list">{g.map((s) => { const chosen = s.options.find((o) => o.id === s.selectedOptionId); const summary = chosen?.name ?? (s.matchExisting ? 'match existing' : s.chosenAreas.length ? s.chosenAreas.join(', ') : Object.values(s.answers).filter(Boolean).slice(0, 2).join(', ')); return <button key={s.id} className="list-row" data-testid="selection-row" onClick={() => navigate(`/projects/${project.id}/selections/${s.id}`)}>
        <span className="grow"><div className="primary">{s.name}</div><div className="secondary">{[s.category, s.room].filter(Boolean).join(' · ')}{s.options.length ? ` · ${s.options.length} option${s.options.length === 1 ? '' : 's'}` : s.fields.length ? ` · ${s.fields.length} to fill in` : s.areas.length ? ' · tick all that apply' : ''}{s.dueDate && s.status !== 'decided' ? ` · decide by ${dateShort(s.dueDate)}` : ''}{summary && s.status === 'decided' ? ` · ${summary}` : ''}</div></span>
        <span className="trailing">{s.overageCents > 0 && <Badge tone="warning">+{money(s.overageCents)} over</Badge>}{isPriced(s) ? <span className="subtle">allowance {money(s.allowanceCents)}</span> : s.byAllowance ? <Badge>by allowance</Badge> : null}<StatusBadge status={s.status} /><Icon name="chevronRight" size={16} /></span>
      </button>; })}</div></div>)}
      {params.get('new') === '1' && <SelectionSheet project={project} onClose={() => setParams({})} onSaved={(s) => navigate(`/projects/${project.id}/selections/${s.id}`)} />}
      {params.get('template') === '1' && <TemplatePicker project={project} onClose={() => setParams({})} onApplied={() => { setParams({}); void refetch(); }} />}
      {selectionId && <SelectionDetail project={project} selectionId={selectionId} onClose={() => navigate(params.get('from') === 'sheet' ? `/projects/${project.id}/selections/sheet` : `/projects/${project.id}/selections`)} />}
    </div>
  );
}

function TemplatePicker({ project, onClose, onApplied }: { project: contracts.ProjectDetail; onClose: () => void; onApplied: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data } = useResource<{ templates: Array<{ key: string; name: string; description: string; intro: string; sections: Array<{ key: string; label: string; note: string; items: Array<{ key: string; name: string; choices: string[]; areas: string[]; fields: string[] }> }> }> }>('/v1/selections/template');
  const { data: existing } = useResource<{ items: contracts.Selection[] }>(`/v1/projects/${project.id}/selections?status=all&limit=200`);
  const [templateKey, setTemplateKey] = useState('checklist');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [release, setRelease] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const template = data?.templates.find((t) => t.key === templateKey);
  const have = new Set((existing?.items ?? []).filter((s) => s.status !== 'void').map((s) => s.templateKey));
  const selectable = template ? template.sections.flatMap((s) => s.items).filter((i) => !have.has(i.key)) : [];
  const chosen = selectable.filter((i) => !off.has(i.key));
  const apply = useApiMutation(() => api.mutate<{ created: number; skipped: number }>('POST', `/v1/projects/${project.id}/selections/apply-template`, { templateKey, itemKeys: chosen.map((i) => i.key), release, dueDate: dueDate || null }), inv(project.id));
  return <Sheet open onClose={onClose} title="Add the standard selections sheet" size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={apply.isPending} disabled={!chosen.length} data-testid="apply-template" onClick={() => apply.mutateAsync(undefined).then((r) => { toast({ message: `Added ${r.data.created} selection${r.data.created === 1 ? '' : 's'}${release ? ' and released them to the client' : ''}.`, tone: 'success' }); onApplied(); }).catch(errorToast)}>Add {chosen.length} item{chosen.length === 1 ? '' : 's'}</Button></>}>
    {!data ? <Skeleton lines={6} /> : <div className="stack">
      <Field label="Which list?"><Select value={templateKey} onChange={(e) => { setTemplateKey(e.target.value); setOff(new Set()); }} data-testid="template-select">{data.templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</Select></Field>
      {template && <p className="muted">{template.description}</p>}
      <div className="form-grid">
        <Field label="Decide by"><Input type="date" value={dueDate} min={todayIso()} onChange={(e) => setDueDate(e.target.value)} /></Field>
        <div style={{ alignSelf: 'end' }}><Switch label="Release to the client right away" checked={release} onChange={setRelease} hint="They see the sheet in their portal and can start filling it in." /></div>
      </div>
      {template?.sections.map((sec) => { const fresh = sec.items.filter((i) => !have.has(i.key)); return <div key={sec.key} className="card" style={{ background: 'var(--bg-sunken)' }}>
        <div className="row-between"><strong>{sec.label}</strong><span className="subtle">{fresh.length === 0 ? 'already on this project' : `${fresh.filter((i) => !off.has(i.key)).length} of ${fresh.length}`}</span></div>
        <div className="row wrap mt-2">{sec.items.map((i) => { const has = have.has(i.key); const on = !has && !off.has(i.key); return <button key={i.key} type="button" className={`chip ${on ? 'on' : ''}`} disabled={has} aria-pressed={on} onClick={() => setOff((prev) => { const n = new Set(prev); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })} title={has ? 'Already on this project' : `${i.choices.length ? `${i.choices.length} choices` : ''}${i.areas.length ? ` · ${i.areas.length} ticks` : ''}${i.fields.length ? ` · ${i.fields.length} to fill in` : ''}`}>{has && <Icon name="check" size={12} />}{i.name}</button>; })}</div>
      </div>; })}
    </div>}
  </Sheet>;
}

function SelectionDetail({ project, selectionId, onClose }: { project: contracts.ProjectDetail; selectionId: string; onClose: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: s, refetch } = useResource<contracts.Selection>(`/v1/selections/${selectionId}`);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [matchExisting, setMatchExisting] = useState(false);
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [decidedByName, setDecidedByName] = useState('');
  const dirtyRef = useRef(false);
  const [dirty, setDirtyState] = useState(false);
  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v); };
  // Load the saved choice into the form, but never over the top of something the person is in the middle of changing.
  useEffect(() => { if (s && !dirtyRef.current) { setPicked(s.selectedOptionId); setAreas(s.chosenAreas); setAnswers(s.answers); setMatchExisting(s.matchExisting); setComment(s.comment); } }, [s?.id, s?.version]);
  const keys = [...inv(project.id), `/v1/selections/${selectionId}`];
  const release = useApiMutation(() => api.mutate('POST', `/v1/selections/${selectionId}/release`, {}), keys);
  const voidIt = useApiMutation(() => api.mutate('POST', `/v1/selections/${selectionId}/void`, {}), keys);
  const decide = useApiMutation((body: Record<string, unknown>) => api.mutate<contracts.Selection>('POST', `/v1/selections/${selectionId}/decide`, body), keys);
  if (!s) return <Sheet open onClose={onClose} title="Selection"><Skeleton lines={6} /></Sheet>;
  const canWrite = session.has('selections.write');
  const portal = !!session.membership?.external;
  const priced = isPriced(s);
  const revisable = s.status === 'decided' && !priced && !s.changeOrderId;
  const canDecide = s.status === 'released' || revisable || (!portal && canWrite && s.status === 'pending');
  const chosenOpt = s.options.find((o) => o.id === picked);
  const overage = chosenOpt && priced ? chosenOpt.priceCents - s.allowanceCents : 0;
  const hasAnswer = !!picked || areas.length > 0 || Object.values(answers).some((v) => v && v.trim()) || matchExisting;
  const mark = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };
  const summaryLines = [chosenOpt ? `Choice: ${chosenOpt.name}` : null, areas.length ? `Ticked: ${areas.join(', ')}` : null, ...Object.entries(answers).filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v}`), matchExisting ? 'Match existing' : null].filter(Boolean) as string[];
  return <Sheet open onClose={onClose} title={s.name} size="lg" footer={<>
    {canWrite && s.status !== 'void' && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    <span className="grow" />
    {canWrite && s.status === 'pending' && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && s.status === 'pending' && s.options.length > 0 && <Button icon="send" onClick={() => release.mutateAsync(undefined).then(() => { toast({ message: 'Released to the client.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Release to client</Button>}
    {canDecide && <Button variant="primary" icon="check" disabled={!hasAnswer || (s.status === 'decided' && !dirty)} onClick={() => setConfirming(true)} data-testid="record-choice">{s.status === 'decided' ? 'Save changes' : portal ? 'Confirm my choice' : 'Record choice'}</Button>}
    {s.changeOrderId && session.has('change_orders.read') && <Button variant="quiet" onClick={() => { onClose(); navigate(`/projects/${project.id}/change-orders/${s.changeOrderId}`); }}>Change order <Icon name="arrowRight" size={14} /></Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={s.status} /><Badge>{s.category}</Badge>{s.room && <Badge>{s.room}</Badge>}{s.byAllowance && <Badge tone="info">By allowance</Badge>}{priced && <span className="subtle">Allowance <strong className="mono">{money(s.allowanceCents)}</strong></span>}{s.dueDate && s.status !== 'decided' ? <span className="subtle">decide by {dateShort(s.dueDate)}</span> : null}{s.decidedByName && s.status === 'decided' && <span className="subtle">decided by {s.decidedByName}{s.decidedAt ? ` · ${dateTime(s.decidedAt)}` : ''}</span>}</div>
    {s.description && <p className="muted mb-2">{s.description}</p>}
    {s.defaultSpec && <div className="card mb-4" style={{ background: 'var(--bg-sunken)' }}><span className="subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>Builder's default</span><div>{s.defaultSpec}</div><div className="subtle">Applies if you make no other choice.</div></div>}
    {s.options.length > 0 && <div className="option-grid">{s.options.map((o) => { const selected = picked === o.id; const diff = o.priceCents - s.allowanceCents; return <button key={o.id} type="button" className={`option-card ${selected ? 'selected' : ''}`} disabled={!canDecide} aria-pressed={selected} data-testid="selection-option" onClick={() => mark(setPicked)(selected && !priced ? null : o.id)}>
      <div className="row-between"><strong>{o.name}</strong>{o.isRecommended && <Badge tone="brand">{priced ? 'recommended' : 'default'}</Badge>}{s.selectedOptionId === o.id && <Badge tone="success">chosen</Badge>}</div>
      {(o.manufacturer || o.model || o.finish) && <div className="subtle">{[o.manufacturer, o.model, o.finish].filter(Boolean).join(' · ')}</div>}
      {o.description && <p className="muted" style={{ margin: '4px 0' }}>{o.description}</p>}
      {priced && <div className="row-between mt-2"><strong className="mono">{money(o.priceCents)}</strong>{diff === 0 ? <Badge tone="success">within allowance</Badge> : diff > 0 ? <Badge tone="warning">+{money(diff)} over allowance</Badge> : <Badge tone="success">{money(-diff)} under</Badge>}</div>}
      {o.sourceUrl && <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="subtle" onClick={(e) => e.stopPropagation()}>Product page <Icon name="external" size={12} /></a>}
    </button>; })}</div>}
    {s.areas.length > 0 && <div className="mt-4"><div className="subtle mb-2">{s.options.length ? 'Where it applies' : 'Tick all that apply'}</div><div className="row wrap" role="group" aria-label="Areas">{s.areas.map((a) => { const on = areas.includes(a); return <button key={a} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={!canDecide} data-testid="area-chip" onClick={() => mark(setAreas)(on ? areas.filter((x) => x !== a) : [...areas, a])}>{on ? '☑' : '☐'} {a}</button>; })}</div></div>}
    {s.fields.length > 0 && <div className="form-grid mt-4">{s.fields.map((f) => <Field key={f} label={f}><Input value={answers[f] ?? ''} disabled={!canDecide} onChange={(e) => mark(setAnswers)({ ...answers, [f]: e.target.value })} placeholder={matchExisting ? 'Match existing' : 'Your choice'} data-testid="answer-field" /></Field>)}</div>}
    {s.templateKey && canDecide && <div className="mt-4"><Switch label="Match existing" hint="For renovations: keep what is there already." checked={matchExisting} onChange={mark(setMatchExisting)} /></div>}
    {canDecide && <div className="mt-4"><Field label={portal ? 'Comments for your builder' : 'Comments'}><Textarea rows={2} value={comment} onChange={(e) => mark(setComment)(e.target.value)} placeholder="Anything we should know about this choice" data-testid="selection-comment" /></Field></div>}
    {!canDecide && s.comment && <p className="muted mt-4">“{s.comment}”</p>}
    {s.approvals.length > 0 && <div className="stack-sm mt-4">{s.approvals.map((a) => <div key={a.id} className="row-between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}><span><StatusBadge status={a.status} /> {a.decidedByName ?? 'Awaiting client'}{a.decisionNote ? ` — “${a.decisionNote}”` : ''}</span><span className="subtle">{dateTime(a.decidedAt ?? a.requestedAt)}</span></div>)}</div>}
    {editing && <SelectionSheet project={project} selection={s} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    <Sheet open={confirming} onClose={() => setConfirming(false)} title={portal ? 'Confirm your choice' : "Record the client's choice"} footer={<><Button onClick={() => setConfirming(false)}>Back</Button><Button variant="primary" loading={decide.isPending} data-testid="confirm-choice" onClick={async () => { if (!portal && !decidedByName.trim() && s.status !== 'decided') { toast({ message: 'Enter who decided.', tone: 'error' }); return; } try { const r = await decide.mutateAsync({ optionId: picked ?? undefined, chosenAreas: areas, answers, matchExisting, note: comment.trim() || undefined, ...(portal ? {} : { decidedByName: decidedByName.trim() || undefined }) }); toast({ message: r.data.changeOrderId && overage > 0 ? 'Choice recorded. A change order was drafted for the amount over the allowance.' : 'Choice recorded.', tone: 'success' }); setConfirming(false); setDirty(false); void refetch(); } catch (e) { errorToast(e); } }}>Confirm</Button></>}>
      <div className="stack">
        {summaryLines.map((l) => <div key={l}>{l}</div>)}
        {comment.trim() && <div className="muted">“{comment.trim()}”</div>}
        {priced && chosenOpt && <>
          <div className="row-between"><span className="muted">Allowance</span><Money cents={s.allowanceCents} /></div>
          <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>{overage > 0 ? 'Added to your contract' : overage < 0 ? 'Credit against the allowance' : 'No change to the contract'}</span><strong className="mono" style={{ color: overage > 0 ? 'var(--warning)' : undefined }}>{overage > 0 ? `+${money(overage)}` : overage < 0 ? `−${money(-overage)}` : '$0.00'}</strong></div>
          {overage > 0 && <p className="subtle">{portal ? 'Your builder will send a change order for this amount for you to approve.' : 'A draft change order for this amount is created for you to send.'}</p>}
        </>}
        {!portal && s.status !== 'decided' && <Field label="Decided by"><Input value={decidedByName} onChange={(e) => setDecidedByName(e.target.value)} placeholder="Jane Smith" autoFocus data-testid="decided-by" /></Field>}
      </div>
    </Sheet>
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this selection?" confirmLabel="Void" message="It is removed from the client's list and the sheet. Any change order already created stays as it is." onConfirm={async () => { try { await voidIt.mutateAsync(undefined); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

type OptionDraft = { id?: string; name: string; description: string; manufacturer: string; model: string; costCents: number; priceCents: number; sourceUrl: string; isRecommended: boolean };
const emptyOption = (): OptionDraft => ({ name: '', description: '', manufacturer: '', model: '', costCents: 0, priceCents: 0, sourceUrl: '', isRecommended: false });

function SelectionSheet({ project, selection, onClose, onSaved }: { project: contracts.ProjectDetail; selection?: contracts.Selection; onClose: () => void; onSaved: (s: contracts.Selection) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: budget } = useResource<contracts.Budget>(`/v1/projects/${project.id}/budget`);
  const [form, setForm] = useState({ category: selection?.category ?? '', room: selection?.room ?? '', name: selection?.name ?? '', description: selection?.description ?? '', allowanceCents: selection?.allowanceCents ?? 0, dueDate: selection?.dueDate ?? '', budgetLineId: selection?.budgetLineId ?? null, defaultSpec: selection?.defaultSpec ?? '', areasText: selection?.areas.join(', ') ?? '', fieldsText: selection?.fields.join(', ') ?? '' });
  const [options, setOptions] = useState<OptionDraft[]>(selection ? selection.options.map((o) => ({ id: o.id, name: o.name, description: o.description, manufacturer: o.manufacturer ?? '', model: o.model ?? '', costCents: o.costCents, priceCents: o.priceCents, sourceUrl: o.sourceUrl ?? '', isRecommended: o.isRecommended })) : [emptyOption(), emptyOption()]);
  const setOpt = (i: number, patch: Partial<OptionDraft>) => setOptions(options.map((o, j) => j === i ? { ...o, ...patch } : o));
  const split = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
  const save = useApiMutation(() => { const { areasText, fieldsText, ...rest } = form; const body = { ...rest, room: form.room || null, dueDate: form.dueDate || null, areas: split(areasText), fields: split(fieldsText), options: options.filter((o) => o.name.trim()).map((o) => ({ ...o, manufacturer: o.manufacturer || null, model: o.model || null, sourceUrl: o.sourceUrl || null })) }; return selection ? api.mutate<contracts.Selection>('PATCH', `/v1/selections/${selection.id}`, body) : api.mutate<contracts.Selection>('POST', `/v1/projects/${project.id}/selections`, body); }, [...inv(project.id), ...(selection ? [`/v1/selections/${selection.id}`] : [])]);
  return <Sheet open onClose={onClose} title={selection ? 'Edit selection' : 'New selection'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim() || !form.category.trim()) { toast({ message: 'Enter a category and a name.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: selection ? 'Selection updated.' : 'Selection created.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{selection ? 'Save' : 'Create'}</Button></>}>
    <div className="form-grid">
      <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} autoFocus placeholder="Tile" list="selection-categories" /><datalist id="selection-categories">{['Tile', 'Plumbing fixtures', 'Lighting', 'Appliances', 'Countertops', 'Cabinet hardware', 'Paint', 'Flooring', 'Doors & hardware'].map((c) => <option key={c} value={c} />)}</datalist></Field>
      <Field label="Room"><Input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Primary bath" /></Field>
      <Field label="Name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Shower floor tile" /></Field>
      <Field label="Allowance" hint="What the contract already includes for this item. Leave at zero for unpriced choices."><MoneyInput value={form.allowanceCents} onChange={(v) => setForm({ ...form, allowanceCents: v })} aria-label="Allowance" /></Field>
      <Field label="Decide by"><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      <Field label="Budget line" className="full"><BudgetLineSelect value={form.budgetLineId} onChange={(id) => setForm({ ...form, budgetLineId: id })} lines={budget?.lines} /></Field>
      <Field label="Notes for the client" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Builder's default" hint="What happens if the client makes no choice." className="full"><Textarea rows={2} value={form.defaultSpec} onChange={(e) => setForm({ ...form, defaultSpec: e.target.value })} /></Field>
      <Field label="Tick-all-that-apply items" hint="Comma separated, e.g. Kitchen, Laundry, Master bath"><Input value={form.areasText} onChange={(e) => setForm({ ...form, areasText: e.target.value })} /></Field>
      <Field label="Fill-in fields" hint="Comma separated, e.g. Manufacturer, Paint color"><Input value={form.fieldsText} onChange={(e) => setForm({ ...form, fieldsText: e.target.value })} /></Field>
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
