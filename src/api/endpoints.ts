import { api } from './client';
import type {
  ApiAddress,
  ApiCartLine,
  ApiDomainEvent,
  ApiNotification,
  ApiOffer,
  ApiOrder,
  ApiUser,
  ApiVehicle,
  CheckoutResponse,
  DeliveryEstimatesResponse,
  UploadTarget,
  OtpRequestResponse,
  OtpVerifyResponse,
  PaymentInit,
  PlanResponse,
  ReferenceResponse,
  RemotePaymentMethod,
  SnapshotResponse,
} from './types';

const auth = { auth: 'required' as const };

export const authApi = {
  requestOtp: (phone: string) => api.post<OtpRequestResponse>('/v1/auth/otp/request', { phone }),
  verifyOtp: (phone: string, code: string, name?: string) => api.post<OtpVerifyResponse>('/v1/auth/otp/verify', { phone, code, ...(name ? { name } : {}) }),
  logout: (refreshToken: string) => api.post<{ ok: true }>('/v1/auth/logout', { refreshToken }),
  me: () => api.get<ApiUser>('/v1/me', auth),
  updateMe: (patch: { name?: string; email?: string }) => api.patch<ApiUser>('/v1/me', patch, auth),
};

export const catalogApi = {
  reference: () => api.get<ReferenceResponse>('/v1/catalog/reference'),
  snapshot: () => api.get<SnapshotResponse>('/v1/catalog/snapshot', { timeoutMs: 20_000 }),
  offers: (ids: string[]) => api.get<{ offers: ApiOffer[] }>('/v1/catalog/offers', { query: { ids: ids.slice(0, 50).join(',') } }),
  deliveryEstimates: (offerIds: string[], city: string) =>
    api.get<DeliveryEstimatesResponse>('/v1/catalog/delivery-estimates', { query: { offerIds: offerIds.slice(0, 50).join(','), city } }),
};

export type VehicleInput = { modelId: string; year: number; trim: string; engine: string; vin?: string };
export type AddressInput = Omit<ApiAddress, 'id'>;

export const meApi = {
  vehicles: () => api.get<{ vehicles: ApiVehicle[] }>('/v1/me/vehicles', auth),
  addVehicle: (v: VehicleInput) => api.post<ApiVehicle>('/v1/me/vehicles', v, auth),
  removeVehicle: (id: string) => api.del<{ ok: true }>(`/v1/me/vehicles/${encodeURIComponent(id)}`, auth),
  addresses: () => api.get<{ addresses: ApiAddress[] }>('/v1/me/addresses', auth),
  addAddress: (a: AddressInput) => api.post<ApiAddress>('/v1/me/addresses', a, auth),
  updateAddress: (id: string, a: AddressInput) => api.put<ApiAddress>(`/v1/me/addresses/${encodeURIComponent(id)}`, a, auth),
  removeAddress: (id: string) => api.del<{ ok: true }>(`/v1/me/addresses/${encodeURIComponent(id)}`, auth),
  cart: () => api.get<{ lines: ApiCartLine[] }>('/v1/me/cart', auth),
  putCart: (lines: ApiCartLine[]) => api.put<{ lines: ApiCartLine[] }>('/v1/me/cart', { lines }, auth),
  notifications: () => api.get<{ notifications: ApiNotification[] }>('/v1/me/notifications', auth),
  markNotificationsRead: () => api.post<{ ok: true }>('/v1/me/notifications/read', {}, auth),
  /** Private, customer-scoped upload target (return photos). */
  createUpload: (input: { purpose: 'return'; contentType: string; sizeBytes: number; fileName: string }) => api.post<UploadTarget>('/v1/me/uploads', input, auth),
};

export type ReturnRequestInput = {
  items: { orderItemId: string; quantity: number }[];
  reason: string;
  note?: string;
  photoKeys?: string[];
  unopened?: boolean;
};

export const checkoutApi = {
  plan: (addressId: string, lines: { offerId: string; quantity: number }[]) => api.post<PlanResponse>('/v1/checkout/plan', { addressId, lines }, auth),
  /** `vehicle` only names a garage vehicle: the server computes fit (and the guarantee) itself. */
  place: (input: { planId: string; idempotencyKey: string; paymentMethod: RemotePaymentMethod; vehicle?: { garageVehicleId: string } }) =>
    // Safe to resend with the same idempotencyKey: the server returns the existing order.
    api.post<CheckoutResponse>('/v1/checkout', input, { ...auth, timeoutMs: 20_000 }),
};

export const ordersApi = {
  list: () => api.get<{ orders: ApiOrder[] }>('/v1/orders', auth),
  get: (id: string) => api.get<ApiOrder>(`/v1/orders/${encodeURIComponent(id)}`, auth),
  retryPayment: (id: string, method: RemotePaymentMethod) => api.post<PaymentInit>(`/v1/orders/${encodeURIComponent(id)}/payment`, { method }, auth),
  cancel: (id: string, reason: string) => api.post<ApiOrder>(`/v1/orders/${encodeURIComponent(id)}/cancel`, { reason }, auth),
  requestReturn: (id: string, input: ReturnRequestInput) =>
    api.post<ApiOrder>(`/v1/orders/${encodeURIComponent(id)}/returns`, input, auth),
  events: (after?: string) => api.get<{ events: ApiDomainEvent[]; cursor: string }>('/v1/events', { ...auth, query: { after } }),
};
