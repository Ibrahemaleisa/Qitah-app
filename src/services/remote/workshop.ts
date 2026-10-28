import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { workshopApi, type ApiOrgMembership, type ApiStatement, type ApiWorkshopQuote, type OrgApplication, type QuoteInput } from '@/api/workshop';
import { isRemote } from '@/config/env';
import { useAppStore } from '@/store/app-store';

/**
 * "وضع الورشة" (workshop mode). The user's organisation memberships and which one (if any) the app acts for.
 * `activeOrgId = null` is retail mode, which behaves exactly as before. Remote mode only.
 */

type WorkshopState = {
  orgs: ApiOrgMembership[];
  /** null = retail mode. */
  activeOrgId: string | null;
  loaded: boolean;
  statements: Record<string, ApiStatement>;
  quotes: Record<string, ApiWorkshopQuote[]>;
  /** Arabic share text (with the link) by quote id: the server keeps only a hash of the token, so the device keeps it to re-share. */
  quoteShares: Record<string, string>;
};

const initial: WorkshopState = { orgs: [], activeOrgId: null, loaded: false, statements: {}, quotes: {}, quoteShares: {} };

export const useWorkshop = create<WorkshopState>()(
  persist(() => initial, {
    name: 'qitah-workshop-mode',
    version: 1,
    storage: createJSONStorage(() => AsyncStorage),
    // Only the choice of mode and the share links survive a restart; everything else is re-read from the server.
    partialize: (s) => ({ activeOrgId: s.activeOrgId, quoteShares: s.quoteShares }),
  }),
);

/** The membership the app currently acts for (undefined in retail mode). */
export function useActiveOrg(): ApiOrgMembership | undefined {
  return useWorkshop((s) => (s.activeOrgId ? s.orgs.find((m) => m.org.id === s.activeOrgId) : undefined));
}

export function activeOrgId(): string | null {
  const { activeOrgId: id, orgs, loaded } = useWorkshop.getState();
  // Until the memberships are loaded, trust the persisted choice; afterwards only a real membership counts.
  if (!id) return null;
  return !loaded || orgs.some((m) => m.org.id === id) ? id : null;
}

export async function refreshOrgs() {
  if (!isRemote || !useAppStore.getState().user) return [];
  const { orgs } = await workshopApi.myOrgs();
  useWorkshop.setState((s) => ({ orgs, loaded: true, activeOrgId: s.activeOrgId && orgs.some((m) => m.org.id === s.activeOrgId) ? s.activeOrgId : null }));
  return orgs;
}

/** Switch between retail (null) and an organisation. The orders screen re-reads its list for the new mode. */
export function setActiveOrg(orgId: string | null) {
  if (useWorkshop.getState().activeOrgId === orgId) return;
  useWorkshop.setState({ activeOrgId: orgId });
}

export async function applyForOrg(input: OrgApplication) {
  const res = await workshopApi.apply(input);
  await refreshOrgs().catch(() => {});
  return res;
}

export async function fetchStatement(orgId: string) {
  const st = await workshopApi.statement(orgId);
  useWorkshop.setState((s) => ({ statements: { ...s.statements, [orgId]: st } }));
  // The statement carries fresh credit numbers: keep the switcher/checkout in sync.
  useWorkshop.setState((s) => ({ orgs: s.orgs.map((m) => (m.org.id === orgId && m.credit ? { ...m, credit: st.credit } : m)) }));
  return st;
}

export async function fetchQuotes(orgId: string) {
  const { quotes } = await workshopApi.quotes(orgId);
  useWorkshop.setState((s) => ({ quotes: { ...s.quotes, [orgId]: quotes } }));
  return quotes;
}

function storeQuote(q: ApiWorkshopQuote) {
  useWorkshop.setState((s) => {
    const list = s.quotes[q.orgId] ?? [];
    return { quotes: { ...s.quotes, [q.orgId]: list.some((x) => x.id === q.id) ? list.map((x) => (x.id === q.id ? q : x)) : [q, ...list] } };
  });
}

export async function fetchQuote(orgId: string, id: string) {
  const q = await workshopApi.quote(orgId, id);
  storeQuote(q);
  return q;
}

export async function createQuote(orgId: string, input: QuoteInput) {
  const q = await workshopApi.createQuote(orgId, input);
  storeQuote(q);
  if (q.share) useWorkshop.setState((s) => ({ quoteShares: { ...s.quoteShares, [q.id]: q.share!.text } }));
  return q;
}

export async function convertQuote(orgId: string, id: string) {
  const res = await workshopApi.convertQuote(orgId, id);
  await fetchQuote(orgId, id).catch(() => {});
  return res;
}

export async function inviteMember(orgId: string, phone: string, role: 'BUYER' | 'TECHNICIAN') {
  return (await workshopApi.invite(orgId, phone, role)).members;
}

export async function removeMember(orgId: string, memberId: string) {
  return (await workshopApi.removeMember(orgId, memberId)).members;
}

let watching = false;
/** Loads memberships after sign-in and forgets them (and workshop mode) on sign-out. */
export function startWorkshopSync() {
  if (!isRemote || watching) return;
  watching = true;
  if (useAppStore.getState().user) refreshOrgs().catch(() => {});
  useAppStore.subscribe((s, prev) => {
    if (prev.user && !s.user) useWorkshop.setState({ ...initial });
    else if (!prev.user && s.user) refreshOrgs().catch(() => {});
  });
}
