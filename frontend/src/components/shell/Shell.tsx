'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, getSession, homeFor, patch, post, Session, setSession } from '@/lib/api';
import { refreshAll, useApi, useSession } from '@/lib/hooks';
import { ago } from '@/lib/format';
import type { Notification, Role, Summary } from '@/lib/types';
import { Icon, IconName } from '@/components/ui/Icon';
import { Avatar, Dialog, Spinner, useToast } from '@/components/ui/primitives';

/** Client-side gate: only the given roles may see the page. */
export function useGate(roles: Role[]): Session | null {
  const { session, ready } = useSession();
  const router = useRouter();
  const key = roles.join(',');
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace('/');
    else if (!key.split(',').includes(session.user.role)) router.replace(homeFor(session.user.role));
  }, [ready, session, router, key]);
  return session && roles.includes(session.user.role) ? session : null;
}

export function FullPageLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <Spinner />
    </div>
  );
}

export function signOut() {
  setSession(null);
  window.location.href = '/';
}

const NAV: Array<{ href: string; label: string; icon: IconName; countKey?: 'new' | 'exceptions' }> = [
  { href: '/admin', label: 'My Orders / Bookings', icon: 'orders', countKey: 'new' },
  { href: '/admin/delivery', label: 'Delivery', icon: 'truck' },
  { href: '/admin/schedule', label: 'Availability & Capacity', icon: 'calendar' },
  { href: '/admin/settlements', label: 'COD Settlement', icon: 'cash' },
];
const PLATFORM: Array<{ label: string; icon: IconName }> = [
  { label: 'My Listing', icon: 'list' },
  { label: 'Workspace Management', icon: 'grid' },
  { label: 'Analytics', icon: 'chart' },
  { label: 'Billing', icon: 'receipt' },
  { label: 'Access Control', icon: 'shield' },
];

export function NotificationBell() {
  const q = useApi<{ unread: number; items: Notification[] }>('/notifications', 20000);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const unread = q.data?.unread ?? 0;
  const role = getSession()?.user.role;
  return (
    <div className="bell" ref={ref}>
      <button className="btn btn-neutral icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
      </button>
      {unread > 0 && <span className="count-badge red">{unread > 99 ? '99+' : unread}</span>}
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="spread" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
            <b>Notifications</b>
            {unread > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  await post('/notifications/read-all', {});
                  refreshAll();
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          {!q.data?.items.length && <div className="empty" style={{ padding: 28 }}>You’re all caught up.</div>}
          {q.data?.items.map((n) => (
            <button
              key={n.id}
              className={`notif${n.read ? '' : ' unread'}`}
              onClick={async () => {
                setOpen(false);
                if (!n.read) await post(`/notifications/${n.id}/read`, {}).catch(() => undefined);
                refreshAll();
                if (n.orderId && role === 'WORKSPACE_ADMIN') router.push(`/admin/orders/${n.orderId}`);
              }}
            >
              <span className={n.read ? 'dotr' : 'dotu'} />
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 650 }}>{n.title}</span>
                {n.body && <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{n.body}</span>}
                <span className="faint" style={{ fontSize: 11.5 }}>{ago(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Figma header “Open / Closed”: whether the workspace takes instant orders. Scheduled bookings still come in. */
function WorkspaceStatus() {
  const q = useApi<{ isOpen: boolean }>('/workspace', 60000);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!q.data) return null;
  const open = q.data.isOpen;

  async function setOpen(next: boolean) {
    setBusy(true);
    try {
      await patch('/workspace/status', { isOpen: next });
      toast(next ? 'Workspace is open for instant orders' : 'Workspace closed — instant orders are paused');
      setConfirm(false);
      q.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not change the status', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={`ws-status${open ? ' on' : ''}`}
        onClick={() => (open ? setConfirm(true) : setOpen(true))}
        disabled={busy}
        title={open ? 'Taking instant orders — click to close' : 'Not taking instant orders — click to open'}
      >
        <span className="dot" />
        {open ? 'Open' : 'Closed'}
      </button>
      {/* portalled: the top bar's backdrop-filter would otherwise trap the fixed-position dialog inside it */}
      {confirm && createPortal(
        <Dialog
          title="Close the workspace?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn btn-neutral" onClick={() => setConfirm(false)}>
                Stay open
              </button>
              <button className="btn btn-danger" onClick={() => setOpen(false)} disabled={busy}>
                {busy && <Spinner />}Close workspace
              </button>
            </>
          }
        >
          <p className="muted">Customers won’t be able to place instant orders until you open again. Scheduled orders and bookings are still accepted, and orders already in progress are not affected.</p>
        </Dialog>,
        document.body,
      )}
    </>
  );
}

function UserMenu({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const u = session.user;
  return (
    <div className="more-wrap" ref={ref}>
      <button className="ws-chip" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="ws-meta" style={{ textAlign: 'left' }}>
          <span className="ws-name" style={{ display: 'block' }}>{u.workspace.name}</span>
          <span className="ws-id" style={{ display: 'block' }}>WSID {u.workspace.code}</span>
        </span>
        <Avatar name={u.name} color={u.avatarColor} />
      </button>
      {open && (
        <div className="menu down" role="menu">
          <div style={{ padding: '8px 10px 10px' }}>
            <div style={{ fontWeight: 700 }}>{u.name}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{u.title ?? u.role}</div>
          </div>
          <button role="menuitem" onClick={signOut}>
            <Icon name="logout" size={15} />
            Switch user
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const session = useGate(['WORKSPACE_ADMIN']);
  const path = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const summary = useApi<Summary>(session ? '/orders/summary' : null, 30000);
  useEffect(() => setNavOpen(false), [path]);
  if (!session) return <FullPageLoader />;
  const counts = summary.data?.counts;
  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">O</span>
          <span className="brand-name">Orqland</span>
        </div>
        {NAV.map((n) => {
          const active = n.href === '/admin' ? path === '/admin' || path.startsWith('/admin/orders') : path.startsWith(n.href);
          const c = n.countKey && counts ? counts[n.countKey] : 0;
          return (
            <Link key={n.href} href={n.href} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon name={n.icon} />
              {n.label}
              {c ? <span className="count-badge">{c}</span> : null}
            </Link>
          );
        })}
        <div className="nav-group">Orqland platform</div>
        {PLATFORM.map((p) => (
          <span key={p.label} className="nav-item disabled" title="Part of the main Orqland platform">
            <Icon name={p.icon} />
            {p.label}
          </span>
        ))}
        <div className="sidebar-foot">
          <Link href="/admin/simulator" className={`nav-item${path.startsWith('/admin/simulator') ? ' active' : ''}`}>
            <Icon name="flask" />
            Customer simulator
          </Link>
          <button className="nav-item" style={{ border: 0, background: 'none', width: '100%', cursor: 'pointer' }} onClick={signOut}>
            <Icon name="logout" />
            Switch user
          </button>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-neutral icon-btn menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Icon name="menu" />
          </button>
          <h1 className="h2 grow ellipsis">{title}</h1>
          {actions}
          <WorkspaceStatus />
          <NotificationBell />
          <UserMenu session={session} />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
