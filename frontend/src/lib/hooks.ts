'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, getSession, Session } from './api';

// A tiny refresh bus: after any mutation, every mounted query reloads.
const listeners = new Set<() => void>();
export function refreshAll(): void {
  listeners.forEach((l) => l());
}

export interface Query<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch `path`, keep data while refetching, poll every `refreshMs` while the tab is visible. */
export function useApi<T>(path: string | null, refreshMs = 0): Query<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (n !== seq.current) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Something went wrong.'));
      })
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
  }, [path]);

  useEffect(() => {
    setData(undefined);
    load();
  }, [load]);

  useEffect(() => {
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !path) return;
    const t = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
    }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, path, load]);

  return { data, error, loading, reload: load };
}

/** Current session (client only). `ready` is false until localStorage has been read. */
export function useSession(): { session: Session | null; ready: boolean } {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
  useEffect(() => {
    setState({ session: getSession(), ready: true });
  }, []);
  return state;
}

/** Re-render every `ms` (for countdowns and relative times). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Debounce a value (search inputs). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Media query hook. */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}
