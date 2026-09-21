import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api } from '../../api/hooks';
import { useSession } from '../../store/session';
import { Button, ErrorState, Field, Input, Spinner } from '../../ui/components';
import { AuthLayout } from './AuthLayout';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const session = useSession();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{ organizationName: string; email: string; roleName: string; invitedByName: string; accountExists: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!token) { setError(new Error('This invitation link is missing its token.')); return; } api.get<any>(`/v1/invitations/${token}`, { cache: false }).then((r) => setPreview(r.data)).catch(setError); }, [token]);
  const accept = async (e?: FormEvent) => {
    e?.preventDefault(); setBusy(true); setError(null);
    try {
      const res = await api.mutate<{ organizationId: string; session: contracts.SessionResponse | null }>('POST', '/v1/invitations/accept', preview?.accountExists ? { token } : { token, ...form });
      if (res.data.session) await session.acceptSession(res.data.session);
      else await session.refresh();
      navigate('/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  if (error && !preview) return <AuthLayout title="Invitation"><ErrorState error={error} /><div className="mt-4"><Link to="/sign-in">Go to sign in</Link></div></AuthLayout>;
  if (!preview) return <AuthLayout title="Invitation"><Spinner /></AuthLayout>;
  const signedInAsInvitee = session.status === 'authenticated' && session.user?.email === preview.email;
  return (
    <AuthLayout title={`Join ${preview.organizationName}`} subtitle={`${preview.invitedByName} invited ${preview.email} as ${preview.roleName}.`}>
      {error ? <div className="mb-4"><ErrorState error={error} /></div> : null}
      {preview.accountExists ? (
        signedInAsInvitee ? <Button variant="primary" size="lg" loading={busy} onClick={() => accept()}>Accept invitation</Button>
          : <div className="stack"><p className="muted">You already have a Buildline account for this email. Sign in, then open this link again.</p><Link className="btn primary lg" to="/sign-in" state={{ from: `/invite?token=${token}` }}>Sign in to accept</Link></div>
      ) : (
        <form onSubmit={accept} className="stack">
          <div className="form-grid">
            <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required autoFocus /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></Field>
          </div>
          <Field label="Choose a password" hint="At least 10 characters."><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} autoComplete="new-password" /></Field>
          <Button type="submit" variant="primary" size="lg" loading={busy}>Create account & join</Button>
        </form>
      )}
    </AuthLayout>
  );
}
