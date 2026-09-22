import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { formatQuantity, type contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, Sheet, Skeleton, StatusBadge, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateLong, dateShort, dateTime, money } from '../../ui/format';
import { useSession } from '../../store/session';
import { Money } from '../financial/shared';

const inv = (projectId: string) => [`/v1/projects/${projectId}`, '/v1/proposals', '/v1/approvals', '/v1/portal', '/v1/budget', '/v1/dashboard'];

export default function ProjectProposals({ project }: { project: contracts.ProjectDetail }) {
  const { proposalId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Proposal[] }>(`/v1/projects/${project.id}/proposals?status=all&limit=100`);
  const items = data?.items ?? [];
  const canWrite = session.has('proposals.write');
  const portal = !!session.membership?.external;
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row wrap">
        <span className="muted">{portal ? 'Proposals from your builder. Open one to review and sign.' : 'A proposal is the client-facing copy of the estimate. Accepting it locks the estimate and sets the contract value.'}</span>
        <span className="grow" />
        {canWrite && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New proposal</Button>}
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={4} /></div>}
      {data && items.length === 0 && <EmptyState icon="file" title="No proposals yet" action={canWrite ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Create one from the estimate</Button> : undefined}>{portal ? 'Nothing has been sent to you yet.' : 'Build the estimate first, then turn it into a proposal for the client to sign.'}</EmptyState>}
      {items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((p) => <button key={p.id} className="list-row" data-testid="proposal-row" onClick={() => navigate(`/projects/${project.id}/proposals/${p.id}`)}>
        <span className="grow"><div className="primary">{p.number} · {p.title}</div><div className="secondary">{p.releasedAt ? `Sent ${dateShort(p.releasedAt)}` : 'Draft'}{p.validUntil ? ` · valid until ${dateShort(p.validUntil)}` : ''}{p.decidedAt ? ` · ${p.status} ${dateShort(p.decidedAt)}` : ''}</div></span>
        <span className="trailing"><Money cents={p.totalCents} /><StatusBadge status={p.status} /><Icon name="chevronRight" size={16} /></span>
      </button>)}</div></div>}
      {params.get('new') === '1' && <ProposalSheet project={project} onClose={() => setParams({})} onSaved={(p) => navigate(`/projects/${project.id}/proposals/${p.id}`)} />}
      {proposalId && <ProposalDetail project={project} proposalId={proposalId} onClose={() => navigate(`/projects/${project.id}/proposals`)} />}
    </div>
  );
}

function ProposalDetail({ project, proposalId, onClose }: { project: contracts.ProjectDetail; proposalId: string; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: p, refetch } = useResource<contracts.Proposal>(`/v1/proposals/${proposalId}`);
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<null | 'accepted' | 'declined'>(null);
  const [voiding, setVoiding] = useState(false);
  const keys = [...inv(project.id), `/v1/proposals/${proposalId}`];
  const act = useApiMutation((path: string) => api.mutate('POST', `/v1/proposals/${proposalId}/${path}`, {}), keys);
  if (!p) return <Sheet open onClose={onClose} title="Proposal"><Skeleton lines={6} /></Sheet>;
  const canWrite = session.has('proposals.write');
  const portal = !!session.membership?.external;
  const open = ['sent', 'viewed'].includes(p.status);
  const snap = p.snapshot;
  return <Sheet open onClose={onClose} title={p.number} size="lg" footer={<>
    {canWrite && p.status !== 'accepted' && p.status !== 'void' && <Button variant="danger" onClick={() => setVoiding(true)}>Void</Button>}
    <span className="grow" />
    {canWrite && p.status === 'draft' && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    {canWrite && p.status === 'draft' && <Button variant="primary" icon="send" onClick={() => act.mutateAsync('send').then(() => { toast({ message: 'Proposal sent to the client.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Send to client</Button>}
    {(portal ? open : canWrite && (open || p.status === 'draft')) && <Button onClick={() => setDeciding('declined')}>Decline</Button>}
    {(portal ? open : canWrite && (open || p.status === 'draft')) && <Button variant="primary" icon="check" onClick={() => setDeciding('accepted')}>{portal ? 'Accept & sign' : 'Record acceptance'}</Button>}
  </>}>
    <div className="row wrap mb-2"><StatusBadge status={p.status} /><strong style={{ fontSize: 'var(--fs-lg)' }}>{p.title}</strong>{p.validUntil && <Badge tone={p.validUntil < new Date().toISOString().slice(0, 10) ? 'danger' : 'neutral'}>valid until {dateShort(p.validUntil)}</Badge>}</div>
    <div className="subtle mb-4">{project.name} · {p.clientName ?? project.clientName ?? 'Client'}{p.releasedAt ? ` · sent ${dateTime(p.releasedAt)}` : ''}</div>
    <div className="card" style={{ background: 'var(--bg-sunken)', boxShadow: 'none' }} data-testid="proposal-document">
      {p.introduction && <p style={{ whiteSpace: 'pre-wrap' }}>{p.introduction}</p>}
      {snap && <div className="table-wrap mt-4"><table className="table">
        <thead><tr><th>Scope</th>{p.displayOptions.showQuantities && <th className="num">Qty</th>}<th className="num">Price</th></tr></thead>
        <tbody>{snap.sections.map((s, i) => <FragmentSection key={i} s={s} opts={p.displayOptions} />)}
          <tr className="subtotal"><td colSpan={p.displayOptions.showQuantities ? 2 : 1}>Total{snap.totals.taxCents ? ` (includes ${money(snap.totals.taxCents)} tax)` : ''}</td><td className="num"><Money cents={snap.totals.sellCents} /></td></tr>
          {snap.totals.allowanceCents > 0 && <tr><td colSpan={p.displayOptions.showQuantities ? 2 : 1} className="muted">Of which allowances (adjusted as you make selections)</td><td className="num"><Money cents={snap.totals.allowanceCents} muted /></td></tr>}
        </tbody>
      </table></div>}
      {p.terms && <><h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Terms</h3><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{p.terms}</p></>}
      {p.signers.length > 0 && <><h3 className="mt-4 mb-2" style={{ fontSize: 'var(--fs-md)' }}>Signers</h3><div className="stack-sm">{p.signers.map((s) => <div key={s.id} className="row-between"><span>{s.name} <span className="subtle">{s.email}</span></span>{s.signedAt ? <Badge tone="success">signed {dateShort(s.signedAt)}</Badge> : <Badge>awaiting signature</Badge>}</div>)}</div></>}
    </div>
    {p.approvals.length > 0 && <div className="stack-sm mt-4">{p.approvals.map((a) => <div key={a.id} className="row-between" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}><span><StatusBadge status={a.status} /> {a.decidedByName ?? 'Awaiting client'}{a.decisionNote ? ` — “${a.decisionNote}”` : ''}</span><span className="subtle">{dateTime(a.decidedAt ?? a.requestedAt)}</span></div>)}</div>}
    {editing && <ProposalSheet project={project} proposal={p} onClose={() => setEditing(false)} onSaved={() => void refetch()} />}
    {deciding && <DecideSheet proposal={p} decision={deciding} portal={portal} keys={keys} onClose={() => setDeciding(null)} onSaved={() => void refetch()} />}
    <ConfirmDialog open={voiding} onClose={() => setVoiding(false)} danger title="Void this proposal?" confirmLabel="Void" message="The client can no longer see or sign it. Create a new proposal for a revised version." onConfirm={async () => { try { await act.mutateAsync('void'); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </Sheet>;
}

function FragmentSection({ s, opts }: { s: NonNullable<contracts.Proposal['snapshot']>['sections'][number]; opts: contracts.Proposal['displayOptions'] }) {
  return <>
    <tr><td colSpan={opts.showQuantities ? 2 : 1} style={{ fontWeight: 650 }}>{s.name}{s.description && <div className="secondary" style={{ fontWeight: 400 }}>{s.description}</div>}</td><td className="num">{opts.showSectionTotals && <Money cents={s.totalCents} />}</td></tr>
    {opts.showLineItems && s.lines.map((l, i) => <tr key={i}><td style={{ paddingLeft: 28 }}>{l.name}{l.isAllowance && <Badge tone="info" style={{ marginLeft: 8 }}>allowance</Badge>}{l.isOptional && <Badge style={{ marginLeft: 8 }}>{l.included ? 'optional · included' : 'optional'}</Badge>}{l.description && <div className="secondary">{l.description}</div>}</td>{opts.showQuantities && <td className="num muted">{formatQuantity(l.quantityThousandths)} {l.unit}</td>}<td className="num"><Money cents={l.sellCents} muted={l.isOptional && !l.included} /></td></tr>)}
  </>;
}

function ProposalSheet({ project, proposal, onClose, onSaved }: { project: contracts.ProjectDetail; proposal?: contracts.Proposal; onClose: () => void; onSaved: (p: contracts.Proposal) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [form, setForm] = useState({ title: proposal?.title ?? `${project.name} — proposal`, introduction: proposal?.introduction ?? '', terms: proposal?.terms ?? '', validUntil: proposal?.validUntil ?? '', showLineItems: proposal?.displayOptions.showLineItems ?? true, showQuantities: proposal?.displayOptions.showQuantities ?? true, refreshSnapshot: false });
  const save = useApiMutation(() => { const body = { title: form.title, introduction: form.introduction, terms: form.terms, validUntil: form.validUntil || null, displayOptions: { showLineItems: form.showLineItems, showQuantities: form.showQuantities, showSectionTotals: true }, ...(proposal ? { refreshSnapshot: form.refreshSnapshot } : {}) }; return proposal ? api.mutate<contracts.Proposal>('PATCH', `/v1/proposals/${proposal.id}`, body) : api.mutate<contracts.Proposal>('POST', `/v1/projects/${project.id}/proposals`, body); }, [...inv(project.id), ...(proposal ? [`/v1/proposals/${proposal.id}`] : [])]);
  return <Sheet open onClose={onClose} title={proposal ? `Edit ${proposal.number}` : 'New proposal'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => { if (!form.title.trim()) { toast({ message: 'Give the proposal a title.', tone: 'error' }); return; } try { const r = await save.mutateAsync(undefined); toast({ message: proposal ? 'Proposal updated.' : 'Proposal created from the estimate.', tone: 'success' }); onClose(); onSaved(r.data); } catch (e) { errorToast(e); } }}>{proposal ? 'Save' : 'Create draft'}</Button></>}>
    <div className="form-grid">
      <Field label="Title" className="full"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
      <Field label="Valid until"><Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></Field>
      <div className="stack-sm" style={{ alignSelf: 'end' }}><label className="row"><input type="checkbox" checked={form.showLineItems} onChange={(e) => setForm({ ...form, showLineItems: e.target.checked })} /> Show line items</label><label className="row"><input type="checkbox" checked={form.showQuantities} onChange={(e) => setForm({ ...form, showQuantities: e.target.checked })} /> Show quantities</label></div>
      <Field label="Introduction" className="full"><Textarea value={form.introduction} onChange={(e) => setForm({ ...form, introduction: e.target.value })} placeholder="Thank you for the opportunity to…" /></Field>
      <Field label="Terms" className="full"><Textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Deposit, draw schedule, allowances, exclusions…" /></Field>
      {proposal && <label className="row full"><input type="checkbox" checked={form.refreshSnapshot} onChange={(e) => setForm({ ...form, refreshSnapshot: e.target.checked })} /> Refresh prices from the current estimate</label>}
    </div>
    <p className="subtle mt-2"><Icon name="info" size={14} /> Sections and lines marked hidden on the estimate are left out. Prices are frozen when the proposal is created.</p>
  </Sheet>;
}

function DecideSheet({ proposal, decision, portal, keys, onClose, onSaved }: { proposal: contracts.Proposal; decision: 'accepted' | 'declined'; portal: boolean; keys: string[]; onClose: () => void; onSaved: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const me = session.user ? `${session.user.firstName} ${session.user.lastName}` : '';
  const [form, setForm] = useState({ signerName: portal ? me : '', note: '', signature: '' });
  const save = useApiMutation(() => api.mutate('POST', `/v1/proposals/${proposal.id}/decide`, { decision, signerName: form.signerName.trim(), note: form.note || undefined, signatureText: form.signature || undefined }), keys);
  const accepting = decision === 'accepted';
  return <Sheet open onClose={onClose} title={accepting ? (portal ? 'Accept and sign' : 'Record acceptance') : 'Decline proposal'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={accepting ? 'primary' : 'danger'} loading={save.isPending} onClick={async () => { if (!form.signerName.trim()) { toast({ message: 'Enter the signer name.', tone: 'error' }); return; } if (accepting && portal && form.signature.trim().toLowerCase() !== form.signerName.trim().toLowerCase()) { toast({ message: 'Type your full name exactly to sign.', tone: 'error' }); return; } try { await save.mutateAsync(undefined); toast({ message: accepting ? 'Accepted. This is now the contract.' : 'Declined.', tone: 'success' }); onClose(); onSaved(); } catch (e) { errorToast(e); } }}>{accepting ? (portal ? 'Sign and accept' : 'Record acceptance') : 'Decline'}</Button></>}>
    {accepting && <div className="card mb-4" style={{ background: 'var(--bg-sunken)', boxShadow: 'none' }}><div className="row-between"><span>Proposal total</span><strong className="mono">{money(proposal.totalCents)}</strong></div><p className="subtle mt-2">By accepting you agree to the scope, price and terms shown in {proposal.number}. The date, time and your name are recorded permanently.</p></div>}
    <div className="form-grid">
      <Field label={portal ? 'Your name' : 'Signer name'} className="full"><Input value={form.signerName} onChange={(e) => setForm({ ...form, signerName: e.target.value })} autoFocus={!portal} placeholder="Jane Smith" /></Field>
      {accepting && portal && <Field label="Type your full name to sign" className="full"><Input value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} autoFocus placeholder={form.signerName} style={{ fontFamily: 'cursive', fontSize: 'var(--fs-lg)' }} data-testid="signature" /></Field>}
      <Field label={accepting ? 'Note (optional)' : 'Reason (optional)'} className="full"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
    </div>
    {!portal && <p className="subtle">Use this when the client signed on paper or by email. Signed on {dateLong(new Date().toISOString().slice(0, 10))}.</p>}
  </Sheet>;
}
