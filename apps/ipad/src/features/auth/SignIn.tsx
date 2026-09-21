import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useSession } from '../../store/session';
import { Button, Field, Input } from '../../ui/components';
import { AuthLayout } from './AuthLayout';

export default function SignIn() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session.status === 'authenticated') return <Navigate to={location.state?.from ?? '/'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await session.signIn(email.trim(), password); navigate(location.state?.from ?? '/', { replace: true }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Your projects are waiting.">
      <form onSubmit={submit} className="stack">
        <Field label="Email"><Input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password" error={error}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required invalid={!!error} /></Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>Sign in</Button>
        <div className="row-between subtle"><Link to="/forgot-password">Forgot password?</Link><Link to="/register">Create a company</Link></div>
      </form>
    </AuthLayout>
  );
}
