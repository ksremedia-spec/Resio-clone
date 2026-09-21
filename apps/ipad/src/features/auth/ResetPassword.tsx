import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../../api/hooks';
import { Button, Field, Input } from '../../ui/components';
import { AuthLayout } from './AuthLayout';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api.mutate('POST', '/v1/auth/password/reset', { token: params.get('token'), password }); navigate('/sign-in', { replace: true }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} className="stack">
        <Field label="New password" hint="At least 10 characters." error={error}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoFocus autoComplete="new-password" /></Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>Save password</Button>
        <Link to="/sign-in" className="subtle">Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}
