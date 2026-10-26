import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isRemote } from '@/config/env';
import { getOffer } from '@/data/offers';
import type { Address, CartLine, Lang, Order, ReturnReason, Vehicle } from '@/domain/types';
import { makeId } from '@/lib/id';
import { buildSampleOrder } from '@/services/orders';

/** `id` is the server user id (remote mode). */
export type User = { id?: string; name: string; phone: string; email?: string };

export type NotificationPrefs = { orderUpdates: boolean; priceDrops: boolean; offers: boolean };

type State = {
  lang: Lang;
  onboardingDone: boolean;
  user: User | null;
  vehicles: Vehicle[];
  selectedVehicleId: string | null;
  cart: CartLine[];
  favorites: string[];
  recentlyViewed: string[];
  recentSearches: string[];
  addresses: Address[];
  orders: Order[];
  notificationPrefs: NotificationPrefs;
  sampleOrderSeeded: boolean;
};

type Actions = {
  setLang: (lang: Lang) => void;
  completeOnboarding: () => void;
  signIn: (user: User) => void;
  updateUser: (patch: Partial<User>) => void;
  signOut: () => void;

  addVehicle: (vehicle: Omit<Vehicle, 'id' | 'addedAt'>) => Vehicle;
  removeVehicle: (id: string) => void;
  selectVehicle: (id: string) => void;

  addToCart: (offerId: string, qty?: number) => void;
  setQty: (offerId: string, qty: number) => void;
  removeFromCart: (offerId: string) => void;
  clearCart: () => void;

  toggleFavorite: (productId: string) => void;
  trackView: (productId: string) => void;
  pushRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;

  saveAddress: (address: Omit<Address, 'id'> & { id?: string }) => Address;
  removeAddress: (id: string) => void;

  /** Remote sync: replace local copies with the account's server state (source of truth). */
  setVehicles: (vehicles: Vehicle[]) => void;
  upsertVehicle: (vehicle: Vehicle) => void;
  setAddresses: (addresses: Address[]) => void;
  setCart: (lines: CartLine[]) => void;
  /** The customer acknowledged a changed price for a cart line. */
  acknowledgePrice: (offerId: string) => void;

  placeOrder: (order: Order) => void;
  cancelOrder: (orderId: string, reason: string) => void;
  requestReturn: (orderId: string, lineId: string, reason: ReturnReason) => void;

  setNotificationPref: (key: keyof NotificationPrefs, value: boolean) => void;
  ensureSampleOrder: () => void;
  resetDemo: () => void;
};

const initialState: State = {
  lang: 'ar',
  onboardingDone: false,
  user: null,
  vehicles: [],
  selectedVehicleId: null,
  cart: [],
  favorites: [],
  recentlyViewed: [],
  recentSearches: [],
  addresses: [],
  orders: [],
  notificationPrefs: { orderUpdates: true, priceDrops: true, offers: false },
  sampleOrderSeeded: false,
};

function clampQty(offerId: string, qty: number): number {
  const stock = getOffer(offerId)?.stock ?? 0;
  return Math.max(0, Math.min(qty, stock, 10));
}

export const useAppStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setLang: (lang) => set({ lang }),
      completeOnboarding: () => set({ onboardingDone: true }),
      signIn: (user) => set({ user }),
      updateUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
      // Remote mode: the garage and addresses belong to the account, so they leave with it.
      signOut: () => set(isRemote ? { user: null, vehicles: [], selectedVehicleId: null, addresses: [] } : { user: null }),

      addVehicle: (input) => {
        const vehicle: Vehicle = { ...input, id: makeId('veh'), addedAt: Date.now() };
        set((s) => ({ vehicles: [vehicle, ...s.vehicles], selectedVehicleId: vehicle.id }));
        return vehicle;
      },
      removeVehicle: (id) =>
        set((s) => {
          const vehicles = s.vehicles.filter((v) => v.id !== id);
          const selectedVehicleId = s.selectedVehicleId === id ? (vehicles[0]?.id ?? null) : s.selectedVehicleId;
          return { vehicles, selectedVehicleId };
        }),
      selectVehicle: (id) => set({ selectedVehicleId: id }),

      addToCart: (offerId, qty = 1) =>
        set((s) => {
          const existing = s.cart.find((l) => l.offerId === offerId);
          if (existing) {
            return { cart: s.cart.map((l) => (l.offerId === offerId ? { ...l, qty: clampQty(offerId, l.qty + qty) } : l)) };
          }
          const clamped = clampQty(offerId, qty);
          return clamped > 0 ? { cart: [...s.cart, { offerId, qty: clamped, seenPrice: getOffer(offerId)?.price }] } : s;
        }),
      setQty: (offerId, qty) =>
        set((s) => {
          const next = clampQty(offerId, qty);
          return {
            cart: next === 0 ? s.cart.filter((l) => l.offerId !== offerId) : s.cart.map((l) => (l.offerId === offerId ? { ...l, qty: next } : l)),
          };
        }),
      removeFromCart: (offerId) => set((s) => ({ cart: s.cart.filter((l) => l.offerId !== offerId) })),
      clearCart: () => set({ cart: [] }),

      toggleFavorite: (productId) =>
        set((s) => ({
          favorites: s.favorites.includes(productId) ? s.favorites.filter((id) => id !== productId) : [productId, ...s.favorites],
        })),
      trackView: (productId) =>
        set((s) => ({ recentlyViewed: [productId, ...s.recentlyViewed.filter((id) => id !== productId)].slice(0, 12) })),
      pushRecentSearch: (query) => {
        const q = query.trim();
        if (!q) return;
        set((s) => ({ recentSearches: [q, ...s.recentSearches.filter((r) => r !== q)].slice(0, 8) }));
      },
      clearRecentSearches: () => set({ recentSearches: [] }),

      saveAddress: (input) => {
        const address: Address = { ...input, id: input.id ?? makeId('addr') };
        set((s) => ({
          addresses: s.addresses.some((a) => a.id === address.id)
            ? s.addresses.map((a) => (a.id === address.id ? address : a))
            : [address, ...s.addresses],
        }));
        return address;
      },
      removeAddress: (id) => set((s) => ({ addresses: s.addresses.filter((a) => a.id !== id) })),

      setVehicles: (vehicles) =>
        set((s) => ({
          vehicles,
          selectedVehicleId: vehicles.some((v) => v.id === s.selectedVehicleId) ? s.selectedVehicleId : (vehicles[0]?.id ?? null),
        })),
      upsertVehicle: (vehicle) =>
        set((s) => ({
          vehicles: s.vehicles.some((v) => v.id === vehicle.id) ? s.vehicles.map((v) => (v.id === vehicle.id ? vehicle : v)) : [vehicle, ...s.vehicles],
          selectedVehicleId: vehicle.id,
        })),
      setAddresses: (addresses) => set({ addresses }),
      setCart: (lines) => set({ cart: lines }),
      acknowledgePrice: (offerId) =>
        set((s) => ({ cart: s.cart.map((l) => (l.offerId === offerId ? { ...l, seenPrice: getOffer(offerId)?.price ?? l.seenPrice } : l)) })),

      placeOrder: (order) => set((s) => ({ orders: [order, ...s.orders], cart: [] })),
      cancelOrder: (orderId, reason) =>
        set((s) => ({
          orders: s.orders.map((o) => (o.id === orderId ? { ...o, cancellation: { requestedAt: Date.now(), reason } } : o)),
        })),
      requestReturn: (orderId, lineId, reason) =>
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id === orderId ? { ...o, returns: [...o.returns, { id: makeId('rt'), lineId, reason, createdAt: Date.now() }] } : o,
          ),
        })),

      setNotificationPref: (key, value) => set((s) => ({ notificationPrefs: { ...s.notificationPrefs, [key]: value } })),
      ensureSampleOrder: () => {
        // Remote mode shows only real orders from the server — never the demo order.
        if (isRemote || get().sampleOrderSeeded) return;
        set((s) => ({ orders: [...s.orders, buildSampleOrder()], sampleOrderSeeded: true }));
      },
      resetDemo: () => {
        const { lang } = get();
        set({ ...initialState, lang, onboardingDone: true, orders: isRemote ? [] : [buildSampleOrder()], sampleOrderSeeded: !isRemote });
      },
    }),
    {
      // Remote and demo state never mix on one device/browser profile.
      name: isRemote ? 'qitah-app-state-remote' : 'qitah-app-state',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function useSelectedVehicle(): Vehicle | undefined {
  return useAppStore((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId));
}

export function useCartCount(): number {
  return useAppStore((s) => s.cart.reduce((sum, l) => sum + l.qty, 0));
}
