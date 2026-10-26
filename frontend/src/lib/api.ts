import type { User } from './types';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const SESSION_KEY = 'oq.session';

export interface Session {
  token: string;
  user: User;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null): void {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — session lasts for this page only */
  }
}

export function homeFor(role: User['role']): string {
  if (role === 'DELIVERY_AGENT') return '/agent';
  if (role === 'SERVICE_PROVIDER') return '/provider';
  return '/admin';
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && session) {
    setSession(null);
    if (typeof window !== 'undefined') window.location.href = '/';
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const b = (body ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };
    throw new ApiError(res.status, b.code ?? 'ERROR', b.message ?? `Request failed (${res.status})`, b.details);
  }
  return body as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const post = <T>(path: string, body: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), idempotencyKey });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });

export function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
