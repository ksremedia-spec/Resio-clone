import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatQuantity, type contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, MenuButton, SearchField, Sheet, Skeleton, Stat, Switch, Textarea, useDebounced, useErrorToast, useToast } from '../../ui/components';
import { money } from '../../ui/format';
import { useSession } from '../../store/session';
import { CostCodeSelect, CostTypeFields, Money, PercentInput, QuantityInput, pct, sumCost, useCostCodes } from '../financial/shared';

type Line = contracts.EstimateLine;

export default function ProjectEstimate({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const base = `/v1/projects/${project.id}/estimate`;
  const { data: est, isLoading, error, refetch } = useResource<contracts.Estimate>(base);
  const [sectionSheet, setSectionSheet] = useState<null | { section?: contracts.EstimateSection }>(null);
  const [lineSheet, setLineSheet] = useState<null | { sectionId: string; line?: Line }>(null);
  const [settings, setSettings] = useState(false);
  const [locking, setLocking] = useState(false);
  const inv = [base, `/v1/projects/${project.id}`, `/v1/projects/${project.id}/budget`, '/v1/budget', '/v1/dashboard'];
  const lock = useApiMutation((apply: boolean) => api.mutate<contracts.Estimate>('POST', `${base}/lock`, { applyContractValue: apply }), inv);
  const unlock = useApiMutation(() => api.mutate<contracts.Estimate>('POST', `${base}/unlock`), inv);
  const deleteSection = useApiMutation((id: string) => api.mutate('DELETE', `${base}/sections/${id}`), inv);
  if (error && !est) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  if (!est) return <div className="page-inner"><Skeleton lines={6} /></div>;
  const canWrite = session.has('estimates.write') && est.status === 'draft';
  const t = est.totals;
  const lineCount = est.sections.reduce((n, s) => n + s.lines.length, 0);
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <Badge tone={est.status === 'locked' ? 'success' : 'neutral'}>{est.status === 'locked' ? 'Locked' : 'Draft'}</Badge>
        <span className="subtle">Markup {pct(est.defaultMarkupBp)} · Tax {pct(est.taxBp)}</span>
        <span className="grow" />
        {session.has('estimates.write') && <Button icon="edit" onClick={() => setSettings(true)} disabled={est.status === 'locked'}>Markup & tax</Button>}
        {canWrite && <Button icon="plus" onClick={() => setSectionSheet({})}>Section</Button>}
        {session.has('estimates.write') && (est.status === 'locked'
          ? <Button onClick={() => unlock.mutateAsync(undefined).then(() => toast({ message: 'Estimate unlocked.', tone: 'success' })).catch(errorToast)}>Unlock</Button>
          : <Button variant="primary" icon="check" onClick={() => setLocking(true)} disabled={lineCount === 0}>Lock estimate</Button>)}
        {session.has('budget.read') && <Button variant="quiet" icon="budget" onClick={() => navigate(`/projects/${project.id}/budget`)}>Budget</Button>}
      </div>
      <div className="stat-row">
        <Stat label="Direct cost" value={money(t.directCostCents)} />
        <Stat label="Markup" value={money(t.markupCents)} />
        <Stat label="Tax" value={money(t.taxCents)} />
        <Stat label="Sell price" value={money(t.sellCents)} tone="ok" />
        <Stat label="Gross margin" value={pct(t.grossMarginBp)} />
        <Stat label="Allowances" value={money(t.allowanceCents)} />
      </div>
      {isLoading && !est && <Skeleton lines={5} />}
      {est.sections.length === 0 && <EmptyState icon="estimating" title="Start the estimate" action={canWrite ? <Button variant="primary" onClick={() => setSectionSheet({})}>Add the first section</Button> : undefined}>Group line items into sections such as Demolition, Framing or Kitchen. Every line is priced from your cost catalog with markup and tax applied automatically.</EmptyState>}
      {est.sections.map((s) => {
        const st = s.totals;
        return <Card key={s.id} title={<span className="row" style={{ gap: 8 }}>{s.name}{!s.clientVisible && <Badge>hidden from client</Badge>}</span>} actions={<span className="row"><span className="subtle mono">{money(st.sellCents)}</span>{canWrite && <Button size="sm" icon="plus" onClick={() => setLineSheet({ sectionId: s.id })}>Line</Button>}{canWrite && <MenuButton items={[{ label: 'Edit section', icon: 'edit', onSelect: () => setSectionSheet({ section: s }) }, { label: 'Delete section', icon: 'trash', danger: true, onSelect: () => deleteSection.mutateAsync(s.id).catch(errorToast) }]} />}</span>}>
          {s.description && <p className="muted mb-2">{s.description}</p>}
          {s.lines.length === 0 ? <p className="muted">No lines yet.</p> : <div className="table-wrap"><table className="table">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Cost</th><th className="num">Markup</th><th className="num">Sell</th></tr></thead>
            <tbody>
              {s.lines.map((l) => <tr key={l.id} className={canWrite ? 'clickable' : ''} data-testid="estimate-line" onClick={() => canWrite && setLineSheet({ sectionId: s.id, line: l })}>
                <td className="name"><div className="primary">{l.name} {l.isAllowance && <Badge tone="info">allowance</Badge>}{l.isOptional && <Badge tone={l.included ? 'brand' : 'neutral'}>{l.included ? 'optional · included' : 'optional'}</Badge>}{l.taxable && <Badge>taxable</Badge>}</div><div className="secondary">{[l.costCode, l.description].filter(Boolean).join(' · ')}</div></td>
                <td className="num">{formatQuantity(l.quantityThousandths)} {l.unit}</td>
                <td className="num"><Money cents={sumCost(l.unitCostCents)} /></td>
                <td className="num"><Money cents={l.totals.directCostCents} muted={l.isOptional && !l.included} /></td>
                <td className="num"><Money cents={l.totals.markupCents} muted /></td>
                <td className="num"><Money cents={l.totals.sellCents} /></td>
              </tr>)}
              <tr className="subtotal"><td>{s.name} subtotal</td><td /><td /><td className="num"><Money cents={st.directCostCents} /></td><td className="num"><Money cents={st.markupCents} /></td><td className="num"><Money cents={st.sellCents} /></td></tr>
            </tbody>
          </table></div>}
        </Card>;
      })}
      {est.notes && <Card title="Notes"><p style={{ whiteSpace: 'pre-wrap' }}>{est.notes}</p></Card>}
      {sectionSheet && <SectionSheet base={base} section={sectionSheet.section} onClose={() => setSectionSheet(null)} />}
      {lineSheet && <LineSheet base={base} sectionId={lineSheet.sectionId} line={lineSheet.line} onClose={() => setLineSheet(null)} />}
      {settings && <SettingsSheet base={base} est={est} onClose={() => setSettings(false)} />}
      <ConfirmDialog open={locking} onClose={() => setLocking(false)} title="Lock the estimate?" confirmLabel="Lock and create budget" message={`Locking freezes ${lineCount} line${lineCount === 1 ? '' : 's'} at ${money(t.sellCents)}, creates the project budget from the costs, and sets the contract value to the sell price. You can unlock later.`} onConfirm={async () => { try { await lock.mutateAsync(true); toast({ message: 'Estimate locked. The budget is live.', tone: 'success' }); } catch (e) { errorToast(e); throw e; } }} />
    </div>
  );
}

function SectionSheet({ base, section, onClose }: { base: string; section?: contracts.EstimateSection; onClose: () => void }) {
  const [form, setForm] = useState({ name: section?.name ?? '', description: section?.description ?? '', clientVisible: section?.clientVisible ?? true });
  const toast = useToast();
  const errorToast = useErrorToast();
  const save = useApiMutation(() => section ? api.mutate('PATCH', `${base}/sections/${section.id}`, form) : api.mutate('POST', `${base}/sections`, form), [base]);
  return <Sheet open onClose={onClose} title={section ? 'Edit section' : 'New section'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim()) { toast({ message: 'Give the section a name.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); } }}>{section ? 'Save' : 'Add section'}</Button></>}>
    <div className="form-grid">
      <Field label="Section name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Kitchen" /></Field>
      <Field label="Description" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="full"><Switch label="Visible to client on proposals" checked={form.clientVisible} onChange={(v) => setForm({ ...form, clientVisible: v })} /></div>
    </div>
  </Sheet>;
}

function LineSheet({ base, sectionId, line, onClose }: { base: string; sectionId: string; line?: Line; onClose: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: codes } = useCostCodes();
  const [form, setForm] = useState({ name: line?.name ?? '', description: line?.description ?? '', costCodeId: line?.costCodeId ?? null, catalogItemId: line?.catalogItemId ?? null, quantityThousandths: line?.quantityThousandths ?? 1000, unit: line?.unit ?? 'ea', unitCostCents: { ...(line?.unitCostCents ?? {}) } as Record<string, number>, taxable: line?.taxable ?? false, isAllowance: line?.isAllowance ?? false, isOptional: line?.isOptional ?? false, included: line?.included ?? true, clientVisible: line?.clientVisible ?? true, notes: line?.notes ?? '' });
  const [pickCatalog, setPickCatalog] = useState(!line);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data: catalog } = useResource<{ items: contracts.CatalogItem[] }>(pickCatalog ? `/v1/catalog?limit=50${dq ? `&q=${encodeURIComponent(dq)}` : ''}` : null);
  const [removing, setRemoving] = useState(false);
  const save = useApiMutation(() => line ? api.mutate('PATCH', `${base}/lines/${line.id}`, form) : api.mutate('POST', `${base}/lines`, { ...form, sectionId }), [base]);
  const remove = useApiMutation(() => api.mutate('DELETE', `${base}/lines/${line!.id}`), [base]);
  const unitTotal = sumCost(form.unitCostCents);
  const applyItem = (i: contracts.CatalogItem) => { setForm({ ...form, name: i.name, description: i.description, costCodeId: i.costCodeId, catalogItemId: i.id, unit: i.unit, unitCostCents: { ...i.unitCostCents } as Record<string, number>, isAllowance: i.isAllowance }); setPickCatalog(false); };
  return <Sheet open onClose={onClose} title={line ? 'Edit line' : 'New line'} size="lg" footer={<>{line && <Button variant="danger" onClick={() => setRemoving(true)}>Delete</Button>}<span className="grow" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim()) { toast({ message: 'Give the line a name.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); } }}>{line ? 'Save' : 'Add line'}</Button></>}>
    {pickCatalog && <div className="card mb-4" style={{ background: 'var(--bg-sunken)', boxShadow: 'none' }}>
      <div className="row-between mb-2"><strong>Start from the catalog</strong><Button size="sm" variant="quiet" onClick={() => setPickCatalog(false)}>Skip</Button></div>
      <SearchField value={q} onChange={setQ} placeholder="Search catalog items" autoFocus />
      <div className="list mt-2" style={{ maxHeight: 220, overflowY: 'auto' }}>{catalog?.items.map((i) => <button key={i.id} className="list-row" style={{ minHeight: 44, background: 'transparent' }} data-testid="catalog-pick" onClick={() => applyItem(i)}><span className="grow"><div className="primary">{i.name}</div><div className="secondary">{[i.costCode, i.unit].filter(Boolean).join(' · ')}</div></span><span className="mono">{money(sumCost(i.unitCostCents))}</span></button>)}{catalog && catalog.items.length === 0 && <p className="muted" style={{ padding: 8 }}>Nothing in the catalog matches. Fill the line in by hand below.</p>}</div>
    </div>}
    <div className="form-grid">
      <Field label="Name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={!pickCatalog} placeholder="Shaker cabinets" /></Field>
      <Field label="Cost code"><CostCodeSelect value={form.costCodeId} onChange={(id) => setForm({ ...form, costCodeId: id })} codes={codes} /></Field>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Field label="Quantity"><QuantityInput value={form.quantityThousandths} onChange={(v) => setForm({ ...form, quantityThousandths: v })} /></Field><Field label="Unit"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="ea, lf, sf, hr" /></Field></div>
      <CostTypeFields value={form.unitCostCents} onChange={(v) => setForm({ ...form, unitCostCents: v })} />
      <div className="full subtle">Unit cost {money(unitTotal)} × {formatQuantity(form.quantityThousandths)} = <strong>{money(Math.round(unitTotal * form.quantityThousandths / 1000))}</strong> direct cost before markup{form.taxable ? ' and tax' : ''}.</div>
      <div className="stack-sm"><Switch label="Taxable" checked={form.taxable} onChange={(v) => setForm({ ...form, taxable: v })} /><Switch label="Allowance" hint="Shown to the client as an allowance they can adjust later." checked={form.isAllowance} onChange={(v) => setForm({ ...form, isAllowance: v })} /></div>
      <div className="stack-sm"><Switch label="Optional item" checked={form.isOptional} onChange={(v) => setForm({ ...form, isOptional: v })} />{form.isOptional && <Switch label="Included in totals" checked={form.included} onChange={(v) => setForm({ ...form, included: v })} />}<Switch label="Visible to client" checked={form.clientVisible} onChange={(v) => setForm({ ...form, clientVisible: v })} /></div>
      <Field label="Description" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </div>
    {line && <ConfirmDialog open={removing} onClose={() => setRemoving(false)} danger title="Delete line?" confirmLabel="Delete" message="The line is removed from the estimate. Budget lines already created from it are kept." onConfirm={async () => { try { await remove.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); throw e; } }} />}
  </Sheet>;
}

function SettingsSheet({ base, est, onClose }: { base: string; est: contracts.Estimate; onClose: () => void }) {
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ name: est.name, defaultMarkupBp: est.defaultMarkupBp, taxBp: est.taxBp, notes: est.notes, markupByCostType: { ...est.markupByCostType } as Record<string, number> });
  const save = useApiMutation(() => api.mutate('PATCH', base, form), [base]);
  return <Sheet open onClose={onClose} title="Markup & tax" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { try { await save.mutateAsync(undefined); onClose(); } catch (e) { errorToast(e); } }}>Save</Button></>}>
    <div className="form-grid">
      <Field label="Estimate name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Default markup %"><PercentInput value={form.defaultMarkupBp} onChange={(v) => setForm({ ...form, defaultMarkupBp: v })} aria-label="Default markup" /></Field>
      <Field label="Sales tax %" hint="Applied only to lines marked taxable."><PercentInput value={form.taxBp} onChange={(v) => setForm({ ...form, taxBp: v })} aria-label="Sales tax" /></Field>
      <Field label="Markup by cost type (optional overrides)" className="full"><div className="cost-types">{(['labor', 'material', 'subcontract', 'equipment', 'other'] as const).map((t) => <label key={t} className="stack-sm" style={{ gap: 4 }}><span className="subtle">{t}</span><Input inputMode="decimal" placeholder={`${est.defaultMarkupBp / 100}`} value={form.markupByCostType[t] != null ? String(form.markupByCostType[t]! / 100) : ''} onChange={(e) => { const next = { ...form.markupByCostType }; const n = Number(e.target.value); if (e.target.value === '' || !Number.isFinite(n)) delete next[t]; else next[t] = Math.round(n * 100); setForm({ ...form, markupByCostType: next }); }} /></label>)}</div></Field>
      <Field label="Notes" className="full"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    </div>
    <p className="subtle mt-2"><Icon name="info" size={14} /> Changing rates re-prices every line immediately.</p>
  </Sheet>;
}
