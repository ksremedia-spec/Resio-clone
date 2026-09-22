import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, MenuButton, SearchField, Segmented, Select, Sheet, Skeleton, Switch, Textarea, Toolbar, useDebounced, useErrorToast, useToast } from '../../ui/components';
import { money } from '../../ui/format';
import { useSession } from '../../store/session';
import { COST_TYPE_LABELS, CostCodeSelect, CostTypeFields, Money, sumCost, useCostCodes } from '../financial/shared';

/** Company-wide estimating setup: the cost code list and the price catalog every estimate draws from. */
export default function Estimating() {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'catalog' | 'codes') ?? 'catalog';
  return <>
    <Toolbar title="Estimating" leading={<MenuToggle />}>
      <Segmented value={tab} onChange={(t) => setParams({ tab: t })} ariaLabel="Estimating view" options={[{ value: 'catalog', label: 'Cost catalog' }, { value: 'codes', label: 'Cost codes' }]} />
      {session.has('estimates.write') && (tab === 'catalog' ? <Button variant="primary" icon="plus" onClick={() => setParams({ tab, new: '1' })}>New item</Button> : <Button variant="primary" icon="plus" onClick={() => setParams({ tab, new: '1' })}>New cost code</Button>)}
      <ToolbarActions />
    </Toolbar>
    <div className="page">{tab === 'catalog' ? <Catalog creating={params.get('new') === '1'} onCloseNew={() => setParams({ tab })} /> : <CostCodes creating={params.get('new') === '1'} onCloseNew={() => setParams({ tab })} />}</div>
  </>;
}

function Catalog({ creating, onCloseNew }: { creating: boolean; onCloseNew: () => void }) {
  const session = useSession();
  const errorToast = useErrorToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.CatalogItem[] }>(`/v1/catalog?limit=200&includeArchived=${showArchived}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`);
  const [editing, setEditing] = useState<contracts.CatalogItem | null>(null);
  const archive = useApiMutation((i: { id: string; archived: boolean }) => api.mutate('POST', `/v1/catalog/${i.id}/archive`, { archived: i.archived }), ['/v1/catalog']);
  const canWrite = session.has('estimates.write');
  return <div className="page-inner stack">
    <div className="row wrap"><div style={{ minWidth: 280 }}><SearchField value={q} onChange={setQ} placeholder="Search the catalog" /></div><label className="row subtle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label></div>
    {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
    {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
    {data && data.items.length === 0 && <EmptyState icon="estimating" title={dq ? 'No matches' : 'Your catalog is empty'}>Save the items you price often (with unit costs per labor, material and subcontract) so estimates and change orders take seconds instead of hours.</EmptyState>}
    {data && data.items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-wrap"><table className="table">
      <thead><tr><th>Item</th><th>Cost code</th><th>Unit</th>{contracts.COST_TYPES.map((t) => <th key={t} className="num">{COST_TYPE_LABELS[t]}</th>)}<th className="num">Unit cost</th><th /></tr></thead>
      <tbody>{data.items.map((i) => <tr key={i.id} className={canWrite ? 'clickable' : ''} data-testid="catalog-row" onClick={() => canWrite && setEditing(i)}>
        <td className="name"><div className="primary">{i.name} {i.isAllowance && <Badge tone="info">allowance</Badge>}{i.archivedAt && <Badge>archived</Badge>}</div><div className="secondary">{i.description}{i.tags.length ? ` · ${i.tags.join(', ')}` : ''}</div></td>
        <td>{i.costCode ?? '—'}</td><td>{i.unit}</td>
        {contracts.COST_TYPES.map((t) => <td key={t} className="num"><Money cents={i.unitCostCents[t] ?? 0} muted={!i.unitCostCents[t]} /></td>)}
        <td className="num"><strong className="mono">{money(sumCost(i.unitCostCents))}</strong></td>
        <td onClick={(e) => e.stopPropagation()}>{canWrite && <MenuButton items={[{ label: 'Edit', icon: 'edit', onSelect: () => setEditing(i) }, { label: i.archivedAt ? 'Restore' : 'Archive', icon: 'trash', danger: !i.archivedAt, onSelect: () => archive.mutateAsync({ id: i.id, archived: !i.archivedAt }).catch(errorToast) }]} />}</td>
      </tr>)}</tbody>
    </table></div></div>}
    {(creating || editing) && <CatalogItemSheet item={editing ?? undefined} onClose={() => { setEditing(null); onCloseNew(); }} />}
  </div>;
}

function CatalogItemSheet({ item, onClose }: { item?: contracts.CatalogItem; onClose: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: codes } = useCostCodes();
  const [form, setForm] = useState({ name: item?.name ?? '', description: item?.description ?? '', costCodeId: item?.costCodeId ?? null, unit: item?.unit ?? 'ea', unitCostCents: { ...(item?.unitCostCents ?? {}) } as Record<string, number>, isAllowance: item?.isAllowance ?? false, tags: item?.tags.join(', ') ?? '' });
  const save = useApiMutation(() => { const body = { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) }; return item ? api.mutate('PATCH', `/v1/catalog/${item.id}`, body) : api.mutate('POST', '/v1/catalog', body); }, ['/v1/catalog']);
  return <Sheet open onClose={onClose} title={item ? 'Edit catalog item' : 'New catalog item'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.name.trim()) { toast({ message: 'Give the item a name.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); toast({ message: item ? 'Item updated.' : 'Item added to the catalog.', tone: 'success' }); onClose(); } catch (e) { errorToast(e); } }}>{item ? 'Save' : 'Add item'}</Button></>}>
    <div className="form-grid">
      <Field label="Name" className="full"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Shaker cabinets, painted" /></Field>
      <Field label="Cost code"><CostCodeSelect value={form.costCodeId} onChange={(id) => setForm({ ...form, costCodeId: id })} codes={codes} /></Field>
      <Field label="Unit"><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="ea, lf, sf, hr" /></Field>
      <CostTypeFields value={form.unitCostCents} onChange={(v) => setForm({ ...form, unitCostCents: v })} label="Unit cost" />
      <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="kitchen, cabinets" /></Field>
      <div style={{ alignSelf: 'end' }}><Switch label="Allowance item" checked={form.isAllowance} onChange={(v) => setForm({ ...form, isAllowance: v })} /></div>
      <Field label="Description" className="full"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </div>
  </Sheet>;
}

function CostCodes({ creating, onCloseNew }: { creating: boolean; onCloseNew: () => void }) {
  const session = useSession();
  const errorToast = useErrorToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error, refetch } = useResource<contracts.CostCode[]>(`/v1/cost-codes?includeArchived=${showArchived}`);
  const [editing, setEditing] = useState<contracts.CostCode | null>(null);
  const archive = useApiMutation((i: { id: string; archived: boolean }) => api.mutate('POST', `/v1/cost-codes/${i.id}/archive`, { archived: i.archived }), ['/v1/cost-codes']);
  const canWrite = session.has('estimates.write');
  const groups = new Map<string, contracts.CostCode[]>();
  for (const c of data ?? []) { const k = c.category ?? 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c); }
  return <div className="page-inner stack">
    <div className="row wrap"><span className="muted">Cost codes group every dollar on estimates, budgets, purchase orders and bills so job costing lines up with your accounting.</span><span className="grow" /><label className="row subtle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label></div>
    {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
    {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
    {data && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-wrap"><table className="table">
      <thead><tr><th>Code</th><th>Name</th><th>Default cost type</th><th /></tr></thead>
      <tbody>{[...groups.entries()].map(([cat, codes]) => <>
        <tr key={`h-${cat}`}><td colSpan={4} className="subtle" style={{ background: 'var(--bg-sunken)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--fs-xs)' }}>{cat}</td></tr>
        {codes.map((c) => <tr key={c.id} className={canWrite ? 'clickable' : ''} data-testid="cost-code-row" onClick={() => canWrite && setEditing(c)}><td className="mono">{c.code}</td><td>{c.name} {c.archivedAt && <Badge>archived</Badge>}</td><td>{COST_TYPE_LABELS[c.defaultCostType]}</td><td onClick={(e) => e.stopPropagation()}>{canWrite && <MenuButton items={[{ label: 'Edit', icon: 'edit', onSelect: () => setEditing(c) }, { label: c.archivedAt ? 'Restore' : 'Archive', icon: 'trash', danger: !c.archivedAt, onSelect: () => archive.mutateAsync({ id: c.id, archived: !c.archivedAt }).catch(errorToast) }]} />}</td></tr>)}
      </>)}</tbody>
    </table></div></div>}
    {(creating || editing) && <CostCodeSheet code={editing ?? undefined} onClose={() => { setEditing(null); onCloseNew(); }} />}
  </div>;
}

function CostCodeSheet({ code, onClose }: { code?: contracts.CostCode; onClose: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ code: code?.code ?? '', name: code?.name ?? '', category: code?.category ?? '', defaultCostType: code?.defaultCostType ?? 'material' });
  const save = useApiMutation(() => { const body = { ...form, category: form.category || null }; return code ? api.mutate('PATCH', `/v1/cost-codes/${code.id}`, body) : api.mutate('POST', '/v1/cost-codes', body); }, ['/v1/cost-codes']);
  return <Sheet open onClose={onClose} title={code ? 'Edit cost code' : 'New cost code'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.code.trim() || !form.name.trim()) { toast({ message: 'Enter a code and a name.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); toast({ message: 'Saved.', tone: 'success' }); onClose(); } catch (e) { errorToast(e); } }}>{code ? 'Save' : 'Add cost code'}</Button></>}>
    <div className="form-grid">
      <Field label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoFocus placeholder="09-300" /></Field>
      <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tile" /></Field>
      <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Finishes" /></Field>
      <Field label="Default cost type"><Select value={form.defaultCostType} onChange={(e) => setForm({ ...form, defaultCostType: e.target.value as any })}>{contracts.COST_TYPES.map((t) => <option key={t} value={t}>{COST_TYPE_LABELS[t]}</option>)}</Select></Field>
    </div>
  </Sheet>;
}
