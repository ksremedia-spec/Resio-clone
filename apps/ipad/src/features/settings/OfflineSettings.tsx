import { useEffect, useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, Progress, useErrorToast, useToast } from '../../ui/components';
import { humanize, timeAgo } from '../../ui/format';
import { on } from '../../store/events';
import { clearOfflineData, downloadForOffline, offlineStatus, refreshOfflineIfEnabled, type OfflineProgress, type OfflineStatus } from '../../store/offline';

const ENTITY_LABELS: Record<string, string> = { project: 'Projects', client: 'Clients', task: 'Tasks', phase: 'Schedule phases', daily_log: 'Daily logs', document: 'Documents', folder: 'Folders', thread: 'Message threads', message: 'Messages', time_entry: 'Time entries', notification: 'Notifications' };

/** Settings → Offline: download everything this person can see so the iPad works with no signal. */
export default function OfflineSettings() {
  const toast = useToast();
  const errorToast = useErrorToast();
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [clearing, setClearing] = useState(false);
  const reload = () => { void offlineStatus().then(setStatus); };
  useEffect(() => { reload(); return on('offline:downloaded', reload); }, []);
  const run = async () => {
    setProgress({ step: 'Starting', done: 0, total: 1 });
    try { const s = await downloadForOffline(setProgress); setStatus(s); toast({ message: `Downloaded ${s.records} records and ${s.urls} screens.`, tone: 'success' }); }
    catch (e) { errorToast(e); }
    finally { setProgress(null); }
  };
  const busy = !!progress;
  return <div className="stack" style={{ maxWidth: 720 }}>
    <h2>Offline</h2>
    <Card>
      <div className="stack-sm">
        <div className="row-between wrap">
          <div><strong>Everything on this iPad</strong><div className="muted">Download every project, task, daily log, document list and message you can see, so you can open them on site with no signal. Changes you make offline are queued and sent when you reconnect.</div></div>
        </div>
        <div className="row wrap">
          <Button variant="primary" icon="download" loading={busy} onClick={() => void run()} data-testid="download-offline">{status?.lastFullAt ? 'Download again' : 'Download for offline'}</Button>
          {status?.lastFullAt && <Button icon="refresh" disabled={busy} onClick={() => refreshOfflineIfEnabled().then(() => { reload(); toast({ message: 'Refreshed.' }); })}>Get latest changes</Button>}
          {status?.lastFullAt && <Button variant="quiet" icon="trash" disabled={busy} onClick={() => setClearing(true)}>Remove downloaded data</Button>}
        </div>
        {progress && <div className="stack-sm" aria-live="polite"><div className="subtle">{progress.step}…</div><Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} /></div>}
        <div className="row wrap subtle" data-testid="offline-status">
          {status?.lastFullAt ? <><Badge tone="success">Ready for offline</Badge><span>Full download {timeAgo(new Date(status.lastFullAt).toISOString())}</span>{status.lastRefreshAt && status.lastRefreshAt !== status.lastFullAt && <span>· refreshed {timeAgo(new Date(status.lastRefreshAt).toISOString())}</span>}</> : <Badge>Not downloaded</Badge>}
        </div>
      </div>
    </Card>
    {status && status.records > 0 && <Card title="What is on this device">
      <div className="stack-sm" data-testid="offline-contents">
        {Object.entries(status.byEntity).sort((a, b) => b[1] - a[1]).map(([entity, n]) => <div key={entity} className="row-between"><span>{ENTITY_LABELS[entity] ?? humanize(entity)}</span><strong>{n}</strong></div>)}
        <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>Screens saved</span><strong>{status.urls}</strong></div>
      </div>
    </Card>}
    <Card title="How offline works">
      <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Any screen you have opened is kept on the device and shown again when there is no signal.</li>
        <li>This download fetches every screen ahead of time, so nothing needs to have been opened first.</li>
        <li>New to-dos, daily logs, time entries and messages made offline are queued (see the banner at the top) and sent in order when you reconnect.</li>
        <li>When you reconnect, only the changes since your last download are fetched.</li>
      </ul>
    </Card>
    <ConfirmDialog open={clearing} onClose={() => setClearing(false)} title="Remove downloaded data?" message="Screens you have opened will need a connection again. Queued changes are not affected." confirmLabel="Remove" danger onConfirm={async () => { await clearOfflineData(); setClearing(false); reload(); toast({ message: 'Removed.' }); }} />
  </div>;
}
