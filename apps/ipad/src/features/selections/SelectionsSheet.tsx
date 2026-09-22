import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ErrorState, Field, Icon, Input, Sheet, Skeleton, Textarea, useErrorToast, useToast } from '../../ui/components';
import { dateLong, dateTime } from '../../ui/format';
import { useSession } from '../../store/session';

const Tick = ({ on }: { on: boolean }) => <span className={`tick ${on ? 'on' : ''}`} aria-hidden="true">{on ? '☑' : '☐'}</span>;

/**
 * The printable selections sheet: every standard item with its choices ticked,
 * the builder's default where nothing was chosen, and the client's signature.
 */
export default function SelectionsSheet({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: sheet, isLoading, error, refetch } = useResource<contracts.SelectionSheet>(`/v1/projects/${project.id}/selections/sheet`, { refetchInterval: 30_000 } as any);
  const [signing, setSigning] = useState(false);
  const [form, setForm] = useState({ signerName: session.membership?.external ? `${session.user?.firstName ?? ''} ${session.user?.lastName ?? ''}`.trim() : '', signatureText: '', note: '' });
  const publish = useApiMutation(() => api.mutate<contracts.Document>('POST', `/v1/projects/${project.id}/selections/publish`, { vendorVisible: true }), [`/v1/projects/${project.id}`, '/v1/documents', '/v1/folders']);
  const sign = useApiMutation(() => api.mutate<contracts.SelectionSheet>('POST', `/v1/projects/${project.id}/selections/sign`, { signerName: form.signerName.trim(), signatureText: form.signatureText.trim() || undefined, note: form.note.trim() || undefined }), [`/v1/projects/${project.id}`, '/v1/selections', '/v1/dashboard']);
  const portal = !!session.membership?.external;
  const canSign = portal || session.has('selections.write');
  if (error && !sheet) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  if (!sheet) return <div className="page-inner"><Skeleton lines={8} /></div>;
  const pct = sheet.counts.total ? Math.round((sheet.counts.decided / sheet.counts.total) * 100) : 0;
  return <div className="page-inner">
    <div className="row wrap no-print" style={{ marginBottom: 'var(--sp-4)' }}>
      <Button variant="quiet" icon="back" onClick={() => navigate(`/projects/${project.id}/selections`)}>Selections</Button>
      <span className="grow" />
      <span className="subtle" data-testid="sheet-progress">{sheet.counts.decided} of {sheet.counts.total} decided · {pct}%</span>
      <Button icon="file" onClick={() => window.print()}>Print / PDF</Button>
      {!portal && session.has('documents.write') && sheet.counts.total > 0 && <Button icon="upload" loading={publish.isPending} data-testid="publish-sheet" onClick={() => publish.mutateAsync(undefined).then((r) => toast({ message: 'Saved to Documents → Specifications, visible to the client and subcontractors.', tone: 'success', action: { label: 'Open', onClick: () => navigate(`/projects/${project.id}/documents?doc=${r.data.id}`) } } as any)).catch(errorToast)}>Publish to documents</Button>}
      {canSign && sheet.counts.decided > 0 && <Button variant="primary" icon="edit" onClick={() => setSigning(true)} data-testid="sign-sheet">{portal ? 'Sign the sheet' : 'Record client signature'}</Button>}
    </div>
    {sheet.counts.total === 0 && <div className="banner syncing no-print" style={{ borderRadius: 'var(--radius-md)', marginBottom: 'var(--sp-4)' }}><Icon name="info" size={18} /><span className="grow">No selections yet. Add the standard selections from the Selections tab to fill this sheet.</span></div>}
    <article className="selections-sheet" data-testid="selections-sheet">
      <header className="sheet-head">
        <div>
          <div className="eyebrow">{sheet.company} · Design / build services</div>
          <h1>Interior selections</h1>
          <div className="muted">{sheet.project.number} · {sheet.project.name}</div>
        </div>
        <div className="sheet-meta">
          <div><span className="label">Client</span>{sheet.project.clientName ?? '—'}</div>
          <div><span className="label">Address</span>{sheet.project.addressLine || '—'}</div>
          <div><span className="label">Date</span>{dateLong(sheet.generatedAt)}</div>
        </div>
      </header>
      {sheet.sections.map((sec) => <section key={sec.key} className="sheet-section">
        <h2>{sec.label}</h2>
        {sec.note && <p className="muted sheet-note">{sec.note}</p>}
        {sec.items.map((s) => {
          const chosen = s.options.find((o) => o.id === s.selectedOptionId);
          const priced = s.options.some((o) => o.priceCents > 0) || s.allowanceCents > 0;
          return <div key={s.id} className={`sheet-item ${s.status}`} data-testid="sheet-item" onClick={() => navigate(`/projects/${project.id}/selections/${s.id}?from=sheet`)} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/projects/${project.id}/selections/${s.id}?from=sheet`); }}>
            <div className="sheet-item-name"><strong>{s.name}</strong>{s.room && <div className="subtle">{s.room}</div>}{s.byAllowance && <div className="subtle">By allowance</div>}</div>
            <div className="sheet-item-body">
              {s.options.length > 0 && <div className="ticks">{s.options.map((o) => <span key={o.id} className={`tick-item ${chosen?.id === o.id ? 'chosen' : ''}`}><Tick on={chosen?.id === o.id} />{o.name}{priced && o.priceCents > 0 ? <span className="subtle"> ${(o.priceCents / 100).toLocaleString()}</span> : null}</span>)}</div>}
              {s.areas.length > 0 && <div className="ticks areas">{s.areas.map((a) => <span key={a} className={`tick-item ${s.chosenAreas.includes(a) ? 'chosen' : ''}`}><Tick on={s.chosenAreas.includes(a)} />{a}</span>)}</div>}
              {s.matchExisting && <div className="tick-item chosen"><Tick on />Match existing</div>}
              {s.fields.length > 0 && <table className="sheet-fields">{s.fields.map((f) => <tr key={f}><th>{f}</th><td>{s.answers[f] ?? ''}</td></tr>)}</table>}
              {s.comment && <div className="sheet-default"><span className="label">Comments</span>{s.comment}</div>}
              {s.defaultSpec && <div className="sheet-default"><span className="label">Default</span>{s.defaultSpec}</div>}
              {s.description && !s.templateKey && <div className="subtle">{s.description}</div>}
            </div>
            <div className="sheet-item-status">
              {s.status === 'decided' ? <><Badge tone="success">Decided</Badge><div className="subtle">{s.decidedByName ?? ''}{s.decidedAt ? ` · ${dateTime(s.decidedAt)}` : ''}</div></> : s.status === 'released' ? <Badge tone="warning">{portal ? 'Your choice' : 'Awaiting client'}</Badge> : <Badge>Not released</Badge>}
            </div>
          </div>;
        })}
      </section>)}
      <footer className="sheet-sign">
        {sheet.signoffs.length > 0 ? sheet.signoffs.map((x) => <div key={x.id} className="signed" data-testid="sheet-signoff">
          <div className="signature">{x.signatureText || x.signerName}</div>
          <div className="row-between"><span><strong>{x.signerName}</strong>{x.byClient ? ' (client)' : ' (recorded by the builder)'}</span><span>{dateLong(x.signedAt)}</span></div>
          <div className="subtle">Signed with {x.decidedCount} item{x.decidedCount === 1 ? '' : 's'} decided.{x.note ? ` “${x.note}”` : ''}</div>
        </div>) : <div className="blank-signature"><div><span className="label">Client signature</span><span className="line" /></div><div><span className="label">Date</span><span className="line" /></div></div>}
      </footer>
    </article>
    <Sheet open={signing} onClose={() => setSigning(false)} title={portal ? 'Sign the selections sheet' : "Record the client's signature"} footer={<><Button onClick={() => setSigning(false)}>Cancel</Button><Button variant="primary" loading={sign.isPending} disabled={!form.signerName.trim()} data-testid="confirm-sign" onClick={() => sign.mutateAsync(undefined).then(() => { setSigning(false); toast({ message: 'Signed.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Sign</Button></>}>
      <div className="stack">
        <p className="muted">This records the sheet exactly as it stands now ({sheet.counts.decided} of {sheet.counts.total} items decided). Items decided later are not covered by this signature.</p>
        {!portal && <Field label="Signed by"><Input value={form.signerName} onChange={(e) => setForm({ ...form, signerName: e.target.value })} placeholder="Client's name" autoFocus /></Field>}
        <Field label="Type your name as a signature"><Input value={form.signatureText} onChange={(e) => setForm({ ...form, signatureText: e.target.value })} placeholder={form.signerName || 'Signature'} style={{ fontFamily: 'cursive', fontSize: 22 }} data-testid="signature-text" /></Field>
        <Field label="Note (optional)"><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </div>
    </Sheet>
  </div>;
}
