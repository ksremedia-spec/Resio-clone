import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { contracts } from '@buildline/core';
import { get, mutate, setAuth, ApiError } from '../api/client';
import { on } from './events';

const STORAGE_KEY = 'buildline.session';

interface Persisted { token: string; organizationId: string | null }
interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: contracts.UserSummary | null;
  memberships: contracts.MembershipSummary[];
  membership: contracts.MembershipSummary | null;
  organizationId: string | null;
  token: string | null;
}

interface SessionApi extends SessionState {
  signIn(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; firstName: string; lastName: string; organizationName: string }): Promise<void>;
  acceptSession(session: contracts.SessionResponse): Promise<void>;
  signOut(): Promise<void>;
  switchOrganization(id: string): Promise<void>;
  refresh(): Promise<void>;
  has(permission: string): boolean;
}

const Ctx = createContext<SessionApi | null>(null);

function load(): Persisted | null { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; } }
function save(p: Persisted | null) { if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); else localStorage.removeItem(STORAGE_KEY); }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null, memberships: [], membership: null, organizationId: null, token: null });

  const applyMe = useCallback((token: string, me: contracts.MeResponse, preferredOrg?: string | null) => {
    const orgId = preferredOrg ?? me.activeOrganizationId ?? me.memberships[0]?.organization.id ?? null;
    const membership = me.memberships.find((m) => m.organization.id === orgId) ?? null;
    setAuth(token, orgId);
    save({ token, organizationId: orgId });
    setState({ status: 'authenticated', user: me.user, memberships: me.memberships, membership, organizationId: orgId, token });
  }, []);

  const refresh = useCallback(async () => {
    const persisted = load();
    if (!persisted) { setAuth(null, null); setState((s) => ({ ...s, status: 'anonymous' })); return; }
    setAuth(persisted.token, persisted.organizationId);
    try {
      const me = await get<contracts.MeResponse>('/v1/auth/me', { cache: true });
      applyMe(persisted.token, me.data, persisted.organizationId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { save(null); setAuth(null, null); setState({ status: 'anonymous', user: null, memberships: [], membership: null, organizationId: null, token: null }); }
      else setState((s) => ({ ...s, status: s.user ? 'authenticated' : 'anonymous' }));
    }
  }, [applyMe]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => on('unauthorized', () => { save(null); setAuth(null, null); setState({ status: 'anonymous', user: null, memberships: [], membership: null, organizationId: null, token: null }); }), []);

  const acceptSession = useCallback(async (session: contracts.SessionResponse) => {
    const orgId = session.activeOrganizationId ?? session.memberships[0]?.organization.id ?? null;
    const membership = session.memberships.find((m) => m.organization.id === orgId) ?? null;
    setAuth(session.token, orgId);
    save({ token: session.token, organizationId: orgId });
    setState({ status: 'authenticated', user: session.user, memberships: session.memberships, membership, organizationId: orgId, token: session.token });
  }, []);

  const api = useMemo<SessionApi>(() => ({
    ...state,
    refresh,
    acceptSession,
    async signIn(email, password) {
      const res = await mutate<contracts.SessionResponse>('POST', '/v1/auth/login', { email, password, deviceName: navigator.userAgent.includes('iPad') ? 'iPad' : 'Web' });
      await acceptSession(res.data);
    },
    async register(input) {
      const res = await mutate<contracts.SessionResponse>('POST', '/v1/auth/register', input);
      await acceptSession(res.data);
    },
    async signOut() {
      try { await mutate('POST', '/v1/auth/logout'); } catch { /* offline: local sign-out still proceeds */ }
      save(null); setAuth(null, null);
      setState({ status: 'anonymous', user: null, memberships: [], membership: null, organizationId: null, token: null });
    },
    async switchOrganization(id) {
      const res = await mutate<contracts.MeResponse>('POST', '/v1/auth/switch-organization', { organizationId: id });
      applyMe(state.token!, res.data, id);
    },
    has: (permission) => !!state.membership?.permissions.includes(permission),
  }), [state, refresh, acceptSession, applyMe]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
