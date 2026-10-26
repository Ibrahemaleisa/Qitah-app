"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { can, type Permission } from "@/lib/permissions";
import type { Me, MerchantProfile, MerchantRole, MerchantStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const STORAGE_KEY = "qitah.merchantId";

type Ctx = {
  me: Me;
  merchantId: string;
  role: MerchantRole;
  status: MerchantStatus;
  displayName: string;
  profile?: MerchantProfile;
  reloadProfile: () => void;
  reloadMe: () => void;
  switchMerchant: (id: string) => void;
  can: (p: Permission) => boolean;
  /** "/v1/merchants/<id>" — prefix for merchant-scoped API paths. */
  base: string;
};

const MerchantCtx = createContext<Ctx | null>(null);

// The selected store lives in localStorage (per browser) and is read through an external store
// so every tab component sees the same value.
const listeners = new Set<() => void>();
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable (private mode): selection just won't persist
  }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function MerchantProvider({ me, reloadMe, children }: { me: Me; reloadMe: () => void; children: ReactNode }) {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const current = me.merchants.find((m) => m.id === stored) ?? me.merchants[0];
  const base = `/v1/merchants/${current.id}`;
  const profile = useApi<MerchantProfile>(base, { refreshOn: ["merchant.updated"] });

  const switchMerchant = useCallback((id: string) => writeStored(id), []);
  const value = useMemo<Ctx>(
    () => ({
      me,
      merchantId: current.id,
      role: current.role,
      // The profile is fresher than /me after an approval event.
      status: profile.data?.status ?? current.status,
      displayName: current.displayNameAr,
      profile: profile.data,
      reloadProfile: profile.reload,
      reloadMe,
      switchMerchant,
      can: (p: Permission) => can(current.role, p),
      base,
    }),
    [me, current, profile.data, profile.reload, reloadMe, switchMerchant, base],
  );
  return <MerchantCtx.Provider value={value}>{children}</MerchantCtx.Provider>;
}

export function useMerchant() {
  const ctx = useContext(MerchantCtx);
  if (!ctx) throw new Error("useMerchant outside MerchantProvider");
  return ctx;
}
