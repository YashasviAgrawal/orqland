'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, getSession, homeFor, post, Session, setSession } from '@/lib/api';
import type { User } from '@/lib/types';
import { Avatar, ErrorBox, Skeleton, Spinner } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { Parcels3D } from '@/components/ui/Parcels3D';

const ROLE_LABEL: Record<User['role'], string> = {
  WORKSPACE_ADMIN: 'Workspace admin',
  DELIVERY_AGENT: 'Delivery agent',
  SERVICE_PROVIDER: 'Service provider',
};
const ROLE_HINT: Record<User['role'], string> = {
  WORKSPACE_ADMIN: 'Review, prepare, assign and settle orders & bookings',
  DELIVERY_AGENT: 'Accept deliveries, update progress and hand over cash',
  SERVICE_PROVIDER: 'Run appointments, sessions and visits',
};

export default function SignIn() {
  const router = useRouter();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (s) {
      router.replace(homeFor(s.user.role));
      return;
    }
    api<User[]>('/auth/demo-users')
      .then(setUsers)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Can’t reach the server.'));
  }, [router]);

  async function signIn(u: User) {
    setBusy(u.id);
    try {
      const s = await post<Session>('/auth/demo-login', { userId: u.id });
      setSession(s);
      router.replace(homeFor(s.user.role));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign in failed.');
      setBusy(null);
    }
  }

  const groups = (['WORKSPACE_ADMIN', 'DELIVERY_AGENT', 'SERVICE_PROVIDER'] as const).map((r) => [r, (users ?? []).filter((u) => u.role === r)] as const);

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">O</span>
          <span className="brand-name">Orqland</span>
        </div>
        <Parcels3D className="login-3d" />
        <div className="big">Every order, booking and rupee, accounted for.</div>
        <div className="ticket" aria-hidden>
          <div className="spread">
            <span className="ocard-code">OQ-100231</span>
            <span className="pill pill-green"><span className="dot" />On the way</span>
          </div>
          <div className="ocard-title" style={{ margin: '8px 0 4px' }}>Handmade Ceramic Mug</div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="ocard-price">₹998</span>
            <span className="ocard-qty">1 pcs</span>
          </div>
          <div className="dest">
            <div className="k">Deliver to</div>
            <div className="v">Park Street, 2nd Block</div>
            <div className="s">Ravi Kumar · picked up 4 min ago</div>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="h1">Sign in to the demo workspace</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 520 }}>
            Choose who you want to be. Each role sees only the orders and actions it is allowed to work on.
          </p>
        </div>
        {error && <ErrorBox message={error} onRetry={() => window.location.reload()} />}
        {!users && !error && (
          <div className="stack">
            <Skeleton h={64} r={14} />
            <Skeleton h={64} r={14} />
            <Skeleton h={64} r={14} />
          </div>
        )}
        {users &&
          groups.map(([role, list]) =>
            list.length ? (
              <div key={role} className="stack" style={{ gap: 8 }}>
                <div>
                  <div className="h3">{ROLE_LABEL[role]}</div>
                  <div className="help">{ROLE_HINT[role]}</div>
                </div>
                <div className="who-grid">
                  {list.map((u) => (
                    <button key={u.id} className="who-btn" onClick={() => signIn(u)} disabled={!!busy}>
                      <Avatar name={u.name} color={u.avatarColor} />
                      <span className="grow">
                        <span style={{ display: 'block', fontWeight: 700 }}>{u.name}</span>
                        <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
                          {u.title}
                          {role === 'DELIVERY_AGENT' && !u.isAvailable ? ' · off duty' : ''}
                        </span>
                      </span>
                      {busy === u.id ? <Spinner /> : <Icon name="chevronRight" />}
                    </button>
                  ))}
                </div>
              </div>
            ) : null,
          )}
      </section>
    </div>
  );
}
