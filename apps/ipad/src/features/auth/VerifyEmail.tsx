import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/hooks';
import { Spinner } from '../../ui/components';
import { AuthLayout } from './AuthLayout';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  useEffect(() => { api.mutate('POST', '/v1/auth/email/verify', { token: params.get('token') }).then(() => setState('done')).catch((e) => { setState('error'); setMessage(e.message); }); }, [params]);
  return <AuthLayout title="Email verification">{state === 'working' ? <Spinner /> : state === 'done' ? <p>Your email is verified. <Link to="/">Continue to Buildline</Link></p> : <p className="error-state">{message}</p>}</AuthLayout>;
}
