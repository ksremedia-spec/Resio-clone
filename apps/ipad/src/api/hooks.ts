import { useEffect } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { get, mutate, upload, type Result, type RequestOptions } from './client';
import { on } from '../store/events';

// networkMode 'always': the API client owns offline behaviour (cache fallback for reads, outbox for writes),
// so queries and mutations must run even when the browser reports no connectivity.
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, networkMode: 'always', retry: (count, err: any) => (err?.status === 0 ? false : count < 1), refetchOnWindowFocus: true }, mutations: { networkMode: 'always' } } });

/** Read a resource; resolves from cache when offline and reports it. */
export function useResource<T>(path: string | null, options: Partial<UseQueryOptions<Result<T>>> = {}) {
  const q = useQuery<Result<T>>({ queryKey: ['api', path], queryFn: () => get<T>(path!), enabled: !!path, ...options } as any);
  return { ...q, data: q.data?.data, fromCache: q.data?.fromCache ?? false };
}

export function useInvalidateOnEvents() {
  const qc = useQueryClient();
  useEffect(() => on('invalidate', (prefixes: string[]) => { void qc.invalidateQueries({ predicate: (query) => { const p = query.queryKey[1]; return typeof p === 'string' && prefixes.some((pre) => p === pre || p.startsWith(pre)); } }); }), [qc]);
}

export function useApiMutation<TInput, TOut>(fn: (input: TInput) => Promise<Result<TOut>>, invalidates: string[] | ((input: TInput, out: TOut) => string[]) = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res, input) => {
      const prefixes = typeof invalidates === 'function' ? invalidates(input, res.data) : invalidates;
      void qc.invalidateQueries({ predicate: (query) => { const p = query.queryKey[1]; return typeof p === 'string' && prefixes.some((pre) => p === pre || p.startsWith(pre)); } });
    },
  });
}

export const api = { get, mutate, upload };
export type { RequestOptions, Result };
