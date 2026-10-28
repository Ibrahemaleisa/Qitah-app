import { fromAddress, toAddress, toVehicle } from '@/api/adapters';
import { onSessionExpired, toApiError } from '@/api/client';
import { authApi, meApi } from '@/api/endpoints';
import { clearTokens, loadTokens, saveTokens } from '@/api/tokens';
import { isRemote } from '@/config/env';
import { getModel } from '@/data/vehicles';
import type { Address, CartLine, Vehicle } from '@/domain/types';
import { useAppStore } from '@/store/app-store';

import { syncPrivateOffers, watchSignOut } from './partRequests';

/**
 * Remote account state: OTP sign-in, profile, and syncing the garage, addresses and cart with the
 * customer's account. When signed in, the server is the source of truth for vehicles and addresses;
 * a guest's local garage/addresses are uploaded once on sign-in.
 */

export const isLocalId = (id: string) => /^(veh|addr)-/.test(id);
const makeIdFor = (modelId: string) => getModel(modelId)?.makeId;

export async function requestOtp(phone: string) {
  return authApi.requestOtp(phone);
}

export async function verifyOtp(phone: string, code: string, name?: string) {
  const res = await authApi.verifyOtp(phone, code, name);
  await saveTokens(res);
  useAppStore.getState().signIn({ id: res.user.id, name: res.user.name ?? name ?? '', phone: res.user.phone ?? phone, email: res.user.email ?? undefined });
  // Sync in the background; sign-in itself has succeeded.
  syncAfterSignIn().catch(() => {});
  return res.user;
}

export async function updateProfile(patch: { name?: string; email?: string }) {
  const user = await authApi.updateMe(patch);
  useAppStore.getState().updateUser({ name: user.name ?? patch.name ?? '', email: user.email ?? undefined });
  return user;
}

/** Revokes the refresh token on the server (best effort), then clears the local session. */
export async function signOut() {
  const tokens = await loadTokens();
  if (tokens?.refreshToken) {
    try {
      await authApi.logout(tokens.refreshToken);
    } catch {
      // Offline sign-out still clears the device; the refresh token then simply expires server-side.
    }
  }
  await clearTokens();
  useAppStore.getState().signOut();
}

export function isSignedIn() {
  return !!useAppStore.getState().user;
}

// ── garage
/** Trim is not used by fitment: only sent when known. */
const vehicleBody = (v: Omit<Vehicle, 'id' | 'addedAt'>) => ({
  modelId: v.modelId,
  year: v.year,
  engine: v.engine,
  ...(v.trim ? { trim: v.trim } : {}),
  ...(v.vin ? { vin: v.vin } : {}),
  ...(v.odometerKm != null ? { odometerKm: v.odometerKm } : {}),
});

export async function pullVehicles() {
  const { vehicles } = await meApi.vehicles();
  useAppStore.getState().setVehicles(vehicles.map((v) => toVehicle(v, makeIdFor)));
}

export async function addVehicle(input: Omit<Vehicle, 'id' | 'addedAt'>): Promise<Vehicle> {
  const store = useAppStore.getState();
  if (!isRemote || !store.user) return store.addVehicle(input);
  const created = await meApi.addVehicle(vehicleBody(input));
  const vehicle = toVehicle(created, makeIdFor);
  useAppStore.getState().upsertVehicle({ ...vehicle, makeId: vehicle.makeId || input.makeId });
  return vehicle;
}

/** Odometer from the garage (PATCH on the account, or kept on the device). */
export async function updateOdometer(id: string, odometerKm: number | null) {
  const store = useAppStore.getState();
  if (isRemote && store.user && !isLocalId(id)) {
    const v = await meApi.updateVehicle(id, { odometerKm });
    useAppStore.getState().updateVehicle(id, { odometerKm: v.odometerKm ?? undefined });
    return;
  }
  store.updateVehicle(id, { odometerKm: odometerKm ?? undefined });
}

export async function removeVehicle(id: string) {
  const store = useAppStore.getState();
  if (isRemote && store.user && !isLocalId(id)) await meApi.removeVehicle(id);
  useAppStore.getState().removeVehicle(id);
}

// ── addresses
export async function pullAddresses() {
  const { addresses } = await meApi.addresses();
  useAppStore.getState().setAddresses(addresses.map(toAddress));
}

export async function saveAddress(input: Omit<Address, 'id'> & { id?: string }): Promise<Address> {
  const store = useAppStore.getState();
  if (!isRemote || !store.user) return store.saveAddress(input);
  const { id, ...body } = input;
  // Editing creates a new server record (orders keep their snapshot); the id changes.
  const saved = toAddress(id && !isLocalId(id) ? await meApi.updateAddress(id, fromAddress(body)) : await meApi.addAddress(fromAddress(body)));
  useAppStore.setState((s) => ({ addresses: [saved, ...s.addresses.filter((a) => a.id !== id && a.id !== saved.id)] }));
  return saved;
}

export async function removeAddress(id: string) {
  const store = useAppStore.getState();
  if (isRemote && store.user && !isLocalId(id)) await meApi.removeAddress(id);
  useAppStore.getState().removeAddress(id);
}

// ── cart
/** Server cart ∪ local cart (local quantity wins), then pushed back so both agree. */
export async function mergeServerCart() {
  const { lines } = await meApi.cart();
  const local = useAppStore.getState().cart;
  const merged: CartLine[] = [...local];
  for (const l of lines) if (!merged.some((m) => m.offerId === l.offerId)) merged.push({ offerId: l.offerId, qty: l.qty });
  useAppStore.getState().setCart(merged);
  await pushCart(merged);
}

let lastPushed = '';
export async function pushCart(lines: CartLine[] = useAppStore.getState().cart) {
  if (!isRemote || !useAppStore.getState().user) return;
  const payload = lines.filter((l) => l.qty > 0).map((l) => ({ offerId: l.offerId, qty: Math.min(50, l.qty) }));
  const key = JSON.stringify(payload);
  if (key === lastPushed) return;
  await meApi.putCart(payload);
  lastPushed = key;
}

// ── sign-in sync
export async function syncAfterSignIn() {
  const store = useAppStore.getState();
  // Upload the guest garage and addresses (local ids) once, then adopt the server's lists.
  for (const v of store.vehicles.filter((x) => isLocalId(x.id))) {
    try {
      await meApi.addVehicle(vehicleBody(v));
    } catch {
      // A vehicle the server rejects (unknown model/spec) stays out of the account rather than blocking sign-in.
    }
  }
  for (const a of store.addresses.filter((x) => isLocalId(x.id))) {
    try {
      const { id: _id, ...body } = a;
      await meApi.addAddress(fromAddress(body));
    } catch {
      // Same: skip invalid guest addresses.
    }
  }
  await Promise.allSettled([pullVehicles(), pullAddresses(), mergeServerCart(), syncPrivateOffers()]);
}

let started = false;

/**
 * Starts background account sync for the app run: refreshes the account on launch, pushes cart
 * changes (debounced), and signs out locally when the server rejects the refresh token.
 */
export function startAccountSync() {
  if (!isRemote || started) return;
  started = true;
  watchSignOut();
  onSessionExpired(() => {
    useAppStore.getState().signOut();
  });
  (async () => {
    const tokens = await loadTokens();
    const user = useAppStore.getState().user;
    if (user && !tokens) {
      // A persisted profile without a session cannot call the API: return to guest.
      useAppStore.getState().signOut();
      return;
    }
    if (user) await Promise.allSettled([pullVehicles(), pullAddresses(), mergeServerCart(), syncPrivateOffers()]);
  })().catch(() => {});

  let timer: ReturnType<typeof setTimeout> | null = null;
  useAppStore.subscribe((state, prev) => {
    if (state.cart === prev.cart || !state.user) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      pushCart(state.cart).catch((e) => {
        // Retry once later on network trouble; other errors (e.g. invalid offer) are ignored.
        if (toApiError(e).isNetwork) setTimeout(() => pushCart().catch(() => {}), 5000);
      });
    }, 800);
  });
}
