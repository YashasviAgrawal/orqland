'use client';
import { ReactNode } from 'react';
import type { Session } from '@/lib/api';
import { Icon, IconName } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/primitives';
import { NotificationBell, signOut } from './Shell';

export interface MTab {
  key: string;
  label: string;
  icon: IconName;
  count?: number;
}

export function MobileShell({ session, tab, tabs, onTab, header, children }: { session: Session; tab: string; tabs: MTab[]; onTab: (k: string) => void; header?: ReactNode; children: ReactNode }) {
  const u = session.user;
  return (
    <div className="m-shell">
      <header className="m-head">
        <div className="spread">
          <div className="row">
            <Avatar name={u.name} color={u.avatarColor} />
            <div>
              <div style={{ fontWeight: 700 }}>Hi, {u.name.split(' ')[0]}</div>
              <div className="muted" style={{ fontSize: 12 }}>{u.workspace.name}</div>
            </div>
          </div>
          <div className="row">
            <NotificationBell />
            <button className="btn btn-neutral icon-btn" onClick={signOut} aria-label="Switch user">
              <Icon name="logout" />
            </button>
          </div>
        </div>
        {header}
      </header>
      <main className="m-body">{children}</main>
      <nav className="m-tabbar" aria-label="Sections" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => onTab(t.key)} aria-current={tab === t.key ? 'page' : undefined}>
            <Icon name={t.icon} size={20} />
            {t.label}
            {t.count ? <span className="count-badge red">{t.count}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
