import { useEffect, useState, type ReactNode } from 'react';
import { bootStandalone, type BootStage } from './boot';

const LABELS: Record<BootStage, string> = { engine: 'Loading the database engine', database: 'Preparing tables', services: 'Starting services', demo: 'Creating the demo company', ready: 'Ready' };

/** Full-screen loading state while the in-page backend boots; renders children when ready. */
export function StandaloneBoot({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<BootStage | null>(null);
  const [detail, setDetail] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { bootStandalone((s, d) => { setStage(s); setDetail(d); }).catch((e) => setError(String(e?.message ?? e))); }, []);
  if (stage === 'ready') return <>{children}</>;
  const steps: BootStage[] = ['engine', 'database', 'services', 'demo'];
  const idx = stage ? steps.indexOf(stage) : -1;
  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="logo"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />Buildline</div>
        {error ? (
          <div className="stack">
            <h2>This browser could not start the demo</h2>
            <p className="muted">The demo runs a small database inside the page using WebAssembly. Your browser or this page's security settings blocked it.</p>
            <pre className="error-state" style={{ whiteSpace: 'pre-wrap' }}>{error}</pre>
            <p className="muted">Try Safari or Chrome on a Mac or iPad, or run the desktop demo described in TESTING.md.</p>
          </div>
        ) : (
          <div className="stack">
            <h2>Setting up your private demo</h2>
            <p className="muted">Everything runs inside this page. Your data stays in this browser.</p>
            <div className="stack-sm">{steps.map((s, i) => <div key={s} className="row" style={{ opacity: i <= idx ? 1 : 0.45 }}>{i < idx ? <span style={{ color: 'var(--success)', width: 22, textAlign: 'center' }}>✓</span> : i === idx ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <span style={{ width: 22 }} />}<span>{LABELS[s]}{i === idx && detail ? <div className="subtle">{detail}</div> : null}</span></div>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
