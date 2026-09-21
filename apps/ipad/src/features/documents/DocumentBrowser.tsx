import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, MenuButton, SearchField, Segmented, Sheet, Skeleton, Switch, useDebounced, useErrorToast, useToast } from '../../ui/components';
import { bytes, dateShort } from '../../ui/format';
import { useSession } from '../../store/session';
import { camera, haptics } from '../../native';
import type { IconName } from '../../ui/icons';

const KIND_ICON: Record<string, IconName> = { photo: 'photo', image: 'photo', pdf: 'file', plan: 'file', contract: 'file', invoice: 'invoices', receipt: 'invoices', spreadsheet: 'estimating', video: 'photo', audio: 'mic', other: 'file' };

/** Folder + document browser shared by the project section and the company-wide page. */
export function DocumentBrowser({ projectId }: { projectId: string | null }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const [params, setParams] = useSearchParams();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [newFolder, setNewFolder] = useState(false);
  const [selected, setSelected] = useState<contracts.Document | null>(null);
  const debounced = useDebounced(q);
  const scope = projectId ? `projectId=${projectId}` : 'company=true';
  const { data: folders, refetch: refetchFolders } = useResource<contracts.Folder[]>(`/v1/folders?${scope}&root=true`);
  const docUrl = `/v1/documents?limit=200${projectId ? `&projectId=${projectId}` : ''}${folderId ? `&folderId=${folderId}` : ''}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`;
  const { data: docs, isLoading, error, refetch, fromCache } = useResource<{ items: contracts.Document[] }>(docUrl);
  const canWrite = session.has('documents.write');
  const upload = async (files: Array<{ blob: Blob; name: string; photo?: Record<string, unknown> }>) => {
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const res = await api.upload<contracts.Document>('/v1/documents/upload', f.blob, f.name, { projectId, folderId, photo: f.photo }, { queue: { entity: 'document', label: `Upload ${f.name}`, optimistic: { id: crypto.randomUUID() }, invalidates: ['/v1/documents', '/v1/folders'] } });
        toast({ message: res.queued ? `${f.name} saved on this iPad; uploads when online.` : `Uploaded ${f.name}.`, tone: res.queued ? undefined : 'success' });
      } catch (e) { errorToast(e, `Unable to upload ${f.name}.`); }
      finally { setUploading((n) => n - 1); }
    }
    void refetch(); void refetchFolders();
  };
  const capture = async () => { const shot = await camera.capture('camera').catch(() => null); if (!shot) return; void haptics.tap(); await upload([{ blob: shot.blob, name: shot.filename, photo: { takenAt: shot.takenAt, latitude: shot.latitude, longitude: shot.longitude } }]); };
  useEffect(() => { if (params.get('capture') === '1' && canWrite) { setParams({}); void capture(); } }, [params]);
  const items = docs?.items ?? [];
  const currentFolder = folders?.find((f) => f.id === folderId);
  return (
    <div className="page-inner stack" onDragOver={(e) => { if (canWrite) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (canWrite) void upload(Array.from(e.dataTransfer.files).map((f) => ({ blob: f, name: f.name }))); }}>
      <div className="row wrap">
        <div className="grow" style={{ maxWidth: 380 }}><SearchField value={q} onChange={setQ} placeholder="Search documents" /></div>
        <Segmented value={view} onChange={setView} ariaLabel="View" options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
        {fromCache && <Badge tone="warning">Cached</Badge>}
        <span className="grow" />
        {canWrite && <><Button icon="folder" onClick={() => setNewFolder(true)}>Folder</Button><Button icon="camera" onClick={capture} data-testid="capture-photo">Photo</Button><Button variant="primary" icon="upload" loading={uploading > 0} onClick={async () => { const files = await camera.pickFiles(); if (files.length) void upload(files.map((f) => ({ blob: f, name: f.name }))); }}>Upload</Button></>}
      </div>
      <div className="row wrap" role="tablist" aria-label="Folders">
        <button className={`chip ${folderId === null ? 'on' : ''}`} onClick={() => setFolderId(null)} role="tab" aria-selected={folderId === null}>All files</button>
        {folders?.map((f) => <button key={f.id} className={`chip ${folderId === f.id ? 'on' : ''}`} onClick={() => setFolderId(f.id)} role="tab" aria-selected={folderId === f.id} onDragOver={(e) => { e.preventDefault(); }} onDrop={async (e) => { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('text/document-id'); if (id) { await api.mutate('PATCH', `/v1/documents/${id}`, { folderId: f.id }); void refetch(); void refetchFolders(); } else if (canWrite) void upload(Array.from(e.dataTransfer.files).map((x) => ({ blob: x, name: x.name }))); }}><Icon name="folder" size={14} />{f.name}<span className="subtle">{f.documentCount}</span>{f.clientVisible && <Icon name="users" size={12} />}</button>)}
      </div>
      {over && <div className="dropzone over">Drop files to upload{currentFolder ? ` into ${currentFolder.name}` : ''}</div>}
      {error && !docs && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !docs && <div className="card"><Skeleton lines={4} /></div>}
      {docs && items.length === 0 && <EmptyState icon="documents" title={debounced ? 'No matching documents' : 'No documents here yet'} action={canWrite && !debounced ? <Button variant="primary" icon="upload" onClick={async () => { const files = await camera.pickFiles(); if (files.length) void upload(files.map((f) => ({ blob: f, name: f.name }))); }}>Upload files</Button> : undefined}>{canWrite ? 'Drag files here, take a photo, or upload from the Files app.' : ''}</EmptyState>}
      {items.length > 0 && view === 'grid' && <div className="photo-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>{items.map((d) => <button key={d.id} className="photo" style={{ border: 0, padding: 0, cursor: 'pointer', aspectRatio: 'auto', minHeight: 150, display: 'flex', flexDirection: 'column' }} draggable onDragStart={(e) => e.dataTransfer.setData('text/document-id', d.id)} onClick={() => setSelected(d)} data-testid="document-tile">
        {d.thumbnailUrl ? <img src={d.thumbnailUrl} alt={d.name} loading="lazy" style={{ flex: 1, minHeight: 0 }} /> : <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}><Icon name={KIND_ICON[d.kind] ?? 'file'} size={40} style={{ color: 'var(--fg-3)' }} /></div>}
        <div style={{ padding: 8, background: 'var(--bg-elev)', textAlign: 'left' }}><div className="truncate" style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{d.name}</div><div className="subtle">{bytes(d.sizeBytes)} · {dateShort(d.createdAt)}{d.clientVisible ? ' · shared' : ''}</div></div>
      </button>)}</div>}
      {items.length > 0 && view === 'list' && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="list">{items.map((d) => <button key={d.id} className="list-row" onClick={() => setSelected(d)} draggable onDragStart={(e) => e.dataTransfer.setData('text/document-id', d.id)}><Icon name={KIND_ICON[d.kind] ?? 'file'} /><span className="grow"><div className="primary truncate">{d.name}</div><div className="secondary">{d.kind} · {bytes(d.sizeBytes)} · v{d.versionCount} · {dateShort(d.createdAt)}</div></span><span className="trailing">{d.clientVisible && <Badge tone="info">client</Badge>}{d.vendorVisible && <Badge>vendor</Badge>}<Icon name="chevronRight" size={16} /></span></button>)}</div></div>}
      {newFolder && <FolderSheet projectId={projectId} onClose={() => { setNewFolder(false); void refetchFolders(); }} />}
      {selected && <DocumentSheet doc={selected} folders={folders ?? []} onClose={() => { setSelected(null); void refetch(); void refetchFolders(); }} />}
    </div>
  );
}

function FolderSheet({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [clientVisible, setClientVisible] = useState(false);
  const [vendorVisible, setVendorVisible] = useState(false);
  const errorToast = useErrorToast();
  const create = useApiMutation(() => api.mutate('POST', '/v1/folders', { projectId, name, clientVisible, vendorVisible }), ['/v1/folders']);
  return <Sheet open onClose={onClose} title="New folder" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutateAsync(undefined).then(onClose).catch(errorToast)}>Create</Button></>}>
    <div className="stack"><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field><Switch label="Visible to client" checked={clientVisible} onChange={setClientVisible} /><Switch label="Visible to vendors" checked={vendorVisible} onChange={setVendorVisible} /></div>
  </Sheet>;
}

function DocumentSheet({ doc, folders, onClose }: { doc: contracts.Document; folders: contracts.Folder[]; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: detail, refetch } = useResource<contracts.Document & { versions: Array<{ id: string; versionNumber: number; sizeBytes: number; createdAt: string; note: string }> }>(`/v1/documents/${doc.id}`);
  const d = detail ?? doc;
  const [name, setName] = useState(doc.name);
  const [tags, setTags] = useState(doc.tags.join(', '));
  const [archiving, setArchiving] = useState(false);
  const canWrite = session.has('documents.write');
  const canShare = session.has('documents.share');
  const save = async (patch: Record<string, unknown>) => { try { await api.mutate('PATCH', `/v1/documents/${doc.id}`, patch); void refetch(); toast({ message: 'Saved.' }); } catch (e) { errorToast(e); } };
  const isImage = d.kind === 'photo' || d.kind === 'image';
  return (
    <Sheet open onClose={onClose} title={d.name} size="lg" footer={<>{canWrite && <Button variant="danger" onClick={() => setArchiving(true)}>Archive</Button>}<span className="grow" /><a className="btn" href={d.downloadUrl?.replace('d=inline', 'd=attachment')} download><Icon name="download" />Download</a><a className="btn primary" href={d.downloadUrl} target="_blank" rel="noreferrer"><Icon name="external" />Open</a></>}>
      <div className="stack">
        {isImage ? <img src={d.downloadUrl} alt={d.name} style={{ maxHeight: 360, width: '100%', objectFit: 'contain', borderRadius: 12, background: 'var(--bg-sunken)' }} /> : d.contentType === 'application/pdf' ? <iframe title={d.name} src={d.downloadUrl} style={{ width: '100%', height: 360, border: 0, borderRadius: 12, background: 'var(--bg-sunken)' }} /> : <div className="doc-tile"><Icon name={KIND_ICON[d.kind] ?? 'file'} /><span>{d.contentType} · {bytes(d.sizeBytes)}</span></div>}
        {d.photo && (d.photo.takenAt || d.photo.latitude) && <div className="subtle">Taken {d.photo.takenAt ? new Date(d.photo.takenAt).toLocaleString() : ''}{d.photo.latitude != null ? ` · ${d.photo.latitude.toFixed(4)}, ${d.photo.longitude?.toFixed(4)}` : ''}{d.photo.device ? ` · ${d.photo.device}` : ''}</div>}
        <div className="form-grid">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== d.name && canWrite) void save({ name: name.trim() }); }} disabled={!canWrite} /></Field>
          <Field label="Folder"><select className="select" value={d.folderId ?? ''} disabled={!canWrite} onChange={(e) => void save({ folderId: e.target.value || null })}><option value="">No folder</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          <Field label="Tags" className="full" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => { if (canWrite) void save({ tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }); }} disabled={!canWrite} /></Field>
          {canShare && <div className="full stack-sm"><Switch label="Visible to client" checked={d.clientVisible} onChange={(v) => void save({ clientVisible: v })} /><Switch label="Visible to vendors" checked={d.vendorVisible} onChange={(v) => void save({ vendorVisible: v })} /></div>}
        </div>
        {detail && <div><h4 className="mb-2">Versions</h4><div className="list">{detail.versions.map((v) => <div key={v.id} className="list-row" style={{ padding: '6px 0', minHeight: 40 }}><span className="grow">v{v.versionNumber} · {bytes(v.sizeBytes)} · {dateShort(v.createdAt)}{v.note ? ` · ${v.note}` : ''}</span></div>)}</div>{canWrite && <Button size="sm" icon="upload" className="mt-2" onClick={async () => { const [f] = await camera.pickFiles('*/*', false); if (!f) return; try { await api.upload('/v1/documents/upload', f, f.name, { documentId: doc.id }); void refetch(); toast({ message: 'New version uploaded.', tone: 'success' }); } catch (e) { errorToast(e); } }}>Upload new version</Button>}</div>}
      </div>
      <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} danger title="Archive document?" confirmLabel="Archive" message="The file is hidden from lists but never deleted. It can be restored from the archived filter." onConfirm={async () => { try { await api.mutate('POST', `/v1/documents/${doc.id}/archive`, { archived: true }); onClose(); } catch (e) { errorToast(e); throw e; } }} />
    </Sheet>
  );
}

export function useMenuNoop() { return MenuButton; }
