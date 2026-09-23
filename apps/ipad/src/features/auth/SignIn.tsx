import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useSession } from '../../store/session';
import { Button, Field, Input, Sheet } from '../../ui/components';
import { API_URL, BUILT_IN_SERVER, getServerOverride, setServerOverride } from '../../api/client';
import { AuthLayout } from './AuthLayout';

const STANDALONE = import.meta.env.VITE_STANDALONE === '1';
const DEMO_USERS = [
  { label: 'Owner', email: 'owner@demo.buildline.app' },
  { label: 'Project manager', email: 'marcus@demo.buildline.app' },
  { label: 'Field supervisor', email: 'rosa@demo.buildline.app' },
  { label: 'Field crew', email: 'jake@demo.buildline.app' },
  { label: 'Office / finance', email: 'tom@demo.buildline.app' },
  { label: 'Homeowner (client portal)', email: 'jane@example.com' },
  { label: 'Subcontractor (vendor portal)', email: 'orders@hillcountrycabinets.example' },
];

export default function SignIn() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverSheet, setServerSheet] = useState(false);
  const [serverUrl, setServerUrl] = useState(getServerOverride() ?? '');
  if (session.status === 'authenticated') return <Navigate to={location.state?.from ?? '/'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await session.signIn(email.trim(), password); navigate(location.state?.from ?? '/', { replace: true }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const quick = async (demoEmail: string) => { setBusy(true); setError(null); try { await session.signIn(demoEmail, 'demo-password-123'); navigate('/', { replace: true }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return (
    <AuthLayout title="Sign in" subtitle={STANDALONE ? 'Private demo: pick a person to sign in as. Everything you do stays in this browser.' : 'Welcome back. Your projects are waiting.'}>
      {STANDALONE && <div className="stack-sm" style={{ marginBottom: 20 }}>{DEMO_USERS.map((u) => <Button key={u.email} size="lg" variant={u.label === 'Owner' ? 'primary' : 'default'} loading={busy} onClick={() => quick(u.email)} data-testid={`demo-${u.label.split(' ')[0]!.toLowerCase()}`}>{u.label}<span className="subtle" style={{ marginLeft: 8, fontWeight: 400 }}>{u.email}</span></Button>)}<div className="subtle" style={{ textAlign: 'center' }}>or sign in with an account you created here</div></div>}
      <form onSubmit={submit} className="stack">
        <Field label="Email"><Input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password" error={error}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required invalid={!!error} /></Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>Sign in</Button>
        <div className="row-between subtle"><Link to="/forgot-password">Forgot password?</Link><Link to="/register">Create a company</Link></div>
      </form>
      {!STANDALONE && <div className="subtle" style={{ marginTop: 20, textAlign: 'center' }}>Server: {API_URL.replace(/^https?:\/\//, '')} · <a onClick={() => setServerSheet(true)} style={{ cursor: 'pointer' }} data-testid="change-server">change</a></div>}
      <Sheet open={serverSheet} onClose={() => setServerSheet(false)} title="Server address" footer={<><Button onClick={() => { setServerOverride(null); window.location.reload(); }}>Use default</Button><Button variant="primary" onClick={() => { const v = serverUrl.trim(); if (!/^https?:\/\//.test(v)) { setError('Enter the full address, starting with https://'); return; } setServerOverride(v); window.location.reload(); }}>Save and reload</Button></>}>
        <div className="stack">
          <p className="muted">This app talks to your company's Buildline server. Change this only if your administrator gave you a different address. The built-in address is <strong>{BUILT_IN_SERVER.replace(/^https?:\/\//, '')}</strong>.</p>
          <Field label="Server address"><Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://buildline.rpvalois.com" inputMode="url" autoCapitalize="none" /></Field>
        </div>
      </Sheet>
    </AuthLayout>
  );
}
