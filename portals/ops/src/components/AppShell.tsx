'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ROLE_LABEL } from '@/lib/labels';
import type { PlatformRole } from '@/lib/types';

import { useLiveStatus } from './LiveEvents';
import { logout, useSession } from './Session';
import { SandboxTag } from './ui';

type NavItem = { href: string; label: string; key: string; role?: PlatformRole; match?: (p: string) => boolean };

const NAV: NavItem[] = [
  { href: '/', label: 'نظرة عامة', key: 'h', match: (p) => p === '/' },
  { href: '/tower', label: 'برج التحكم', key: 't', match: (p) => p.startsWith('/tower') },
  { href: '/exceptions', label: 'الاستثناءات', key: 'e' },
  { href: '/orders', label: 'الطلبات', key: 'o' },
  { href: '/merchants', label: 'التجار', key: 'm', match: (p) => p.startsWith('/merchants') },
  { href: '/performance', label: 'أداء التجار', key: 'p' },
  { href: '/organizations', label: 'الورش', key: 'w' },
  { href: '/part-requests', label: 'طلبات القطع', key: 'q' },
  { href: '/returns', label: 'المرتجعات', key: 'r' },
  { href: '/finance', label: 'المالية', key: 'f', role: 'FINANCE' },
  { href: '/commission', label: 'قواعد العمولة', key: 'c', role: 'FINANCE' },
  { href: '/audit', label: 'سجل التدقيق', key: 'a' },
  { href: '/staff', label: 'فريق العمليات', key: 's', role: 'OPS_ADMIN' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, has, sandbox } = useSession();
  const { connected } = useLiveStatus();
  const path = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const items = NAV.filter((n) => !n.role || has(n.role));

  // Keyboard: "/" focuses search; "g" then a letter navigates (g t → control tower …).
  useEffect(() => {
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'g') {
        gPressed = Date.now();
        return;
      }
      if (Date.now() - gPressed < 1200) {
        const item = items.find((n) => n.key === e.key.toLowerCase());
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        gPressed = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, router]);

  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setMenuOpen(false);
  }

  const isActive = (n: NavItem) => (n.match ? n.match(path) : path === n.href || path.startsWith(`${n.href}/`));

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        تخطَّ إلى المحتوى
      </a>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="التنقل الرئيسي">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            ق
          </span>
          <div>
            <div className="brand-name">قطعة</div>
            <div className="brand-sub">بوابة العمليات</div>
          </div>
        </div>
        <nav>
          <ul>
            {items.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={isActive(n) ? 'active' : ''} aria-current={isActive(n) ? 'page' : undefined}>
                  <span>{n.label}</span>
                  <kbd aria-hidden>g {n.key}</kbd>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <div className="user">
            <div className="user-name">{me.name ?? me.email}</div>
            <div className="user-roles">{me.platformRoles.map((r) => ROLE_LABEL[r] ?? r).join(' · ')}</div>
          </div>
          <button className="btn btn-sm btn-ghost-inverse" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      </aside>
      {menuOpen ? <button className="scrim" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} /> : null}
      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="القائمة" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            ☰
          </button>
          <form
            role="search"
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              const v = q.trim();
              if (v) router.push(`/orders?q=${encodeURIComponent(v)}`);
            }}
          >
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث برقم الطلب أو الجوال…  ( / )"
              aria-label="بحث عن طلب برقم الطلب أو رقم الجوال"
              dir="auto"
            />
          </form>
          <div className="topbar-end">
            {sandbox ? <SandboxTag>بيئة تجريبية</SandboxTag> : null}
            <span className={`live ${connected ? 'on' : 'off'}`} role="status" title={connected ? 'متصل بالتحديث المباشر' : 'تحديث دوري كل 20 ثانية'}>
              <span className="dot" aria-hidden />
              {connected ? 'مباشر' : 'تحديث دوري'}
            </span>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Wraps role-restricted pages. */
export function RequireRole({ role, children }: { role: PlatformRole; children: React.ReactNode }) {
  const { has } = useSession();
  if (!has(role)) {
    return (
      <div className="card narrow">
        <h1 className="h2">لا تملك صلاحية هذه الصفحة</h1>
        <p className="muted">هذه الصفحة تتطلب دور: {ROLE_LABEL[role]}.</p>
      </div>
    );
  }
  return <>{children}</>;
}
