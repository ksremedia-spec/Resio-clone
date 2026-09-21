import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useSession } from '../../store/session';
import { Button, Field, Input } from '../../ui/components';
import { AuthLayout } from './AuthLayout';

export default function Register() {
  const session = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: '', firstName: '', lastName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session.status === 'authenticated') return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await session.register({ ...form, email: form.email.trim() }); navigate('/', { replace: true }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Create your company" subtitle="You will be the owner and can invite your team next.">
      <form onSubmit={submit} className="stack">
        <Field label="Company name"><Input value={form.organizationName} onChange={set('organizationName')} required autoFocus /></Field>
        <div className="form-grid">
          <Field label="First name"><Input value={form.firstName} onChange={set('firstName')} required autoComplete="given-name" /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={set('lastName')} required autoComplete="family-name" /></Field>
        </div>
        <Field label="Work email"><Input type="email" value={form.email} onChange={set('email')} required autoComplete="email" autoCapitalize="none" /></Field>
        <Field label="Password" hint="At least 10 characters." error={error}><Input type="password" value={form.password} onChange={set('password')} required minLength={10} autoComplete="new-password" /></Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>Create company</Button>
        <div className="subtle" style={{ textAlign: 'center' }}>Already have an account? <Link to="/sign-in">Sign in</Link></div>
      </form>
    </AuthLayout>
  );
}
