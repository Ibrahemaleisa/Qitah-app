"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ErrorNote, Spinner } from "@/components/ui/bits";
import { authPost } from "@/lib/api";
import { MERCHANT_STATUS_AR, ROLE_AR } from "@/lib/labels";
import type { Permission } from "@/lib/permissions";
import type { Me, Notification } from "@/lib/types";
import { useApi } from "@/lib/useApi";

import { MerchantProvider, useMerchant } from "./MerchantContext";
import { RealtimeProvider, useRealtimeMode } from "./Realtime";

type NavItem = { href: string; label: string; perm?: Permission };

const NAV: NavItem[] = [
  { href: "/", label: "الرئيسية" },
  { href: "/orders", label: "الطلبات", perm: "orders" },
  { href: "/catalog", label: "العروض والمخزون", perm: "stock" },
  { href: "/returns", label: "المرتجعات", perm: "returns" },
  { href: "/locations", label: "الفروع ومواقع الاستلام", perm: "locations.manage" },
  { href: "/settlements", label: "المستحقات والتسويات", perm: "settlements" },
  { href: "/staff", label: "فريق العمل", perm: "staff" },
  { href: "/notifications", label: "الإشعارات" },
  { href: "/activity", label: "سجل النشاط", perm: "activity" },
  { href: "/store", label: "المتجر والتوثيق" },
];

export async function logout() {
  try {
    await authPost("/api/auth/logout", {});
  } finally {
    // Full page load on purpose: drop every in-memory view of the previous session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

export function PortalShell({ children }: { children: ReactNode }) {
  const me = useApi<Me>("/v1/me", { refreshOn: ["merchant.updated"] });

  if (me.error && me.error.status !== 401) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <ErrorNote error={me.error} />
        <button type="button" className="btn btn-secondary mt-3" onClick={me.reload}>
          إعادة المحاولة
        </button>
      </main>
    );
  }
  if (!me.data) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </main>
    );
  }
  if (me.data.merchants.length === 0) return <NoStore me={me.data} />;

  return (
    <MerchantProvider me={me.data} reloadMe={me.reload}>
      <RealtimeProvider>
        <Frame>{children}</Frame>
      </RealtimeProvider>
    </MerchantProvider>
  );
}

function NoStore({ me }: { me: Me }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center p-6">
      <div className="card p-6 text-center">
        <h1 className="text-xl font-bold text-brand">لا يوجد متجر مرتبط بحسابك</h1>
        <p className="mt-2 text-sm text-slate">
          سجّلت الدخول بالحساب <span className="ltr">{me.email ?? me.phone}</span>. لم تتم إضافتك إلى أي متجر بعد. يمكنك تقديم طلب انضمام متجر جديد، أو اطلب من مالك المتجر إضافتك إلى فريقه.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/register" className="btn btn-primary">
            تسجيل متجر جديد
          </Link>
          <button type="button" className="btn btn-secondary" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      </div>
    </main>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const m = useMerchant();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV.filter((n) => !n.perm || m.can(n.perm));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <nav aria-label="القائمة الرئيسية">
      <ul className="space-y-0.5">
        {items.map((n) => (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={() => setMenuOpen(false)}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`flex items-center rounded-lg px-3 py-2 text-[14.5px] font-medium transition-colors ${
                isActive(n.href) ? "bg-brand-50 font-semibold text-brand" : "text-ink hover:bg-mist"
              }`}
            >
              {isActive(n.href) && <span className="me-2 inline-block h-4 w-1 rounded-full bg-accent" aria-hidden />}
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        تخطَّ إلى المحتوى
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4">
          <button type="button" className="btn btn-ghost btn-sm lg:hidden" aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen((v) => !v)}>
            <span aria-hidden>☰</span>
            <span className="sr-only">القائمة</span>
          </button>
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="الرئيسية — بوابة تجار قطعة">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/qitah-symbol.svg" alt="" width={36} height={18} className="h-[18px] w-9" />
            <span className="hidden font-bold text-brand sm:inline">قطعة</span>
            <span className="hidden text-sm text-slate sm:inline">| بوابة التجار</span>
          </Link>
          <div className="ms-auto flex min-w-0 items-center gap-2">
            <LiveIndicator />
            <StoreSwitcher />
            <Bell />
            <UserMenu />
          </div>
        </div>
      </header>

      {menuOpen && (
        <div id="mobile-nav" className="border-b border-line bg-white p-3 lg:hidden">
          <p className="mb-2 px-3 text-sm font-semibold text-slate sm:hidden">{m.displayName}</p>
          {nav}
        </div>
      )}

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-5">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-20">{nav}</div>
        </aside>
        <main id="main" className="min-w-0 flex-1 pb-16">
          {m.status !== "APPROVED" && <StatusBanner />}
          {children}
        </main>
      </div>
    </div>
  );
}

function StatusBanner() {
  const m = useMerchant();
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/store") return null;
  const danger = m.status === "REJECTED" || m.status === "SUSPENDED";
  return (
    <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${danger ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning-text"}`}>
      حالة المتجر: <strong>{MERCHANT_STATUS_AR[m.status]}</strong>. لا يمكن نشر العروض أو استقبال الطلبات قبل اعتماد المتجر.{" "}
      <Link href="/store" className="font-semibold underline">
        التفاصيل
      </Link>
    </div>
  );
}

function LiveIndicator() {
  const mode = useRealtimeMode();
  const text = mode === "live" ? "مباشر" : mode === "polling" ? "تحديث كل 30 ث" : "جارٍ الاتصال";
  return (
    <span className="hidden items-center gap-1.5 text-xs text-slate md:inline-flex" data-testid="realtime-mode" data-mode={mode}>
      <span className={`inline-block h-2 w-2 rounded-full ${mode === "live" ? "bg-success" : mode === "polling" ? "bg-warning" : "bg-line-strong"}`} aria-hidden />
      {text}
    </span>
  );
}

function StoreSwitcher() {
  const m = useMerchant();
  if (m.me.merchants.length < 2) {
    return (
      <span className="hidden max-w-[16rem] truncate text-sm font-semibold text-ink sm:inline" title={m.displayName}>
        {m.displayName}
      </span>
    );
  }
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">المتجر الحالي</span>
      <select className="select input-sm max-w-[14rem]" value={m.merchantId} onChange={(e) => m.switchMerchant(e.target.value)} data-testid="store-switcher">
        {m.me.merchants.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayNameAr} — {ROLE_AR[s.role]}
            {s.status !== "APPROVED" ? ` (${MERCHANT_STATUS_AR[s.status]})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function Bell() {
  const m = useMerchant();
  const { data } = useApi<{ notifications: Notification[] }>(`${m.base}/notifications`, {
    refreshOn: ["order.paid", "merchant_order", "return", "merchant", "notifications"],
  });
  const unread = data?.notifications.filter((n) => !n.readAt).length ?? 0;
  return (
    <Link href="/notifications" className="btn btn-ghost btn-sm relative" aria-label={unread ? `الإشعارات، ${unread} غير مقروءة` : "الإشعارات"}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-1 end-0 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-5 text-white" data-testid="unread-count">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

function UserMenu() {
  const m = useMerchant();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)} data-testid="user-menu">
        <span className="max-w-[8rem] truncate">{m.me.name ?? m.me.email}</span>
        <span className="text-xs text-muted">{ROLE_AR[m.role]}</span>
      </button>
      {open && (
        <div role="menu" className="card absolute end-0 top-11 z-40 w-64 p-2 shadow-lg" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="border-b border-line px-2 pb-2 text-sm">
            <p className="font-semibold">{m.me.name}</p>
            <p className="ltr text-start text-xs text-slate">{m.me.email}</p>
            <p className="mt-1 text-xs text-slate">
              {m.displayName} — {ROLE_AR[m.role]}
            </p>
          </div>
          <Link role="menuitem" href="/register" className="mt-1 block rounded px-2 py-2 text-sm hover:bg-mist" onClick={() => setOpen(false)}>
            تسجيل متجر آخر
          </Link>
          <button role="menuitem" type="button" className="block w-full rounded px-2 py-2 text-start text-sm text-danger hover:bg-danger-soft" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}
