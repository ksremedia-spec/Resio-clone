import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/hooks';
import { Button, Field, Input } from '../../ui/components';
import { AuthLayout } from './AuthLayout';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api.mutate('POST', '/v1/auth/password/forgot', { email: email.trim() }); setDone(true); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to choose a new password.">
      {done ? <p>If an account exists for <strong>{email}</strong>, a reset link is on its way. <Link to="/sign-in">Back to sign in</Link></p> : (
        <form onSubmit={submit} className="stack">
          <Field label="Email" error={error}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoCapitalize="none" /></Field>
          <Button type="submit" variant="primary" size="lg" loading={busy}>Send reset link</Button>
          <Link to="/sign-in" className="subtle">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}
