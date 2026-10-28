import { create } from 'zustand';

import { toApiError } from '@/api/client';
import {
  partRequestApi,
  photoContentType,
  toPartRequestDetail,
  toPartRequestSummary,
  toPrivateCatalog,
  type CreatePartRequestBody,
  type PartRequestDetail,
  type PartRequestSummary,
} from '@/api/partRequests';
import { addPrivateCatalog, clearPrivateCatalog, setPrivateCatalog, useRemoteCatalog } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import type { PartArtKind } from '@/domain/types';
import { useAppStore } from '@/store/app-store';

/**
 * Part requests (remote mode): the customer's requests and quotes, photo upload, accepting a quote
 * (→ private offer added to the cart) and syncing the private offers the cart/checkout rely on.
 * Not persisted: always re-read from the API.
 */

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type State = {
  list: PartRequestSummary[];
  listState: LoadState;
  byId: Record<string, PartRequestDetail>;
};

export const usePartRequests = create<State>()(() => ({ list: [], listState: 'idle', byId: {} }));

export const MAX_PHOTOS = 3;

export type LocalPhoto = { uri: string; mimeType?: string | null; fileSize?: number | null; fileName?: string | null };

const artFor = (categoryId: string) => useRemoteCatalog.getState().categories.find((c) => c.id === categoryId)?.art as PartArtKind | undefined;

function storeDetail(d: PartRequestDetail) {
  usePartRequests.setState((s) => ({
    byId: { ...s.byId, [d.id]: d },
    list: s.list.some((x) => x.id === d.id) ? s.list.map((x) => (x.id === d.id ? { ...x, ...summaryOf(d) } : x)) : [summaryOf(d), ...s.list],
  }));
}

function summaryOf(d: PartRequestDetail): PartRequestSummary {
  const { photos: _p, quotes: _q, ...summary } = d;
  return summary;
}

export async function fetchPartRequests() {
  usePartRequests.setState((s) => ({ listState: s.list.length ? s.listState : 'loading' }));
  try {
    const { requests } = await partRequestApi.list();
    usePartRequests.setState({ list: requests.map(toPartRequestSummary), listState: 'ready' });
  } catch (e) {
    usePartRequests.setState({ listState: 'error' });
    throw toApiError(e);
  }
}

export async function fetchPartRequest(id: string) {
  const d = toPartRequestDetail(await partRequestApi.get(id));
  storeDetail(d);
  return d;
}

/** Uploads one local photo through the signed URL the API returns; resolves to its private key. */
export async function uploadPhoto(photo: LocalPhoto, fetchImpl: typeof fetch = fetch): Promise<string> {
  const contentType = photoContentType(photo.mimeType, photo.uri);
  if (!contentType) throw Object.assign(new Error('Unsupported photo type'), { code: 'UNSUPPORTED_TYPE' });
  const blob = await (await fetchImpl(photo.uri)).blob();
  const target = await partRequestApi.upload({ contentType, sizeBytes: photo.fileSize || blob.size, fileName: photo.fileName || (contentType === 'image/png' ? 'part.png' : 'part.jpg') });
  const res = await fetchImpl(target.uploadUrl, { method: target.method, headers: target.headers, body: blob });
  if (!res.ok) throw Object.assign(new Error(`Upload failed (${res.status})`), { code: 'UPLOAD_FAILED' });
  return target.key;
}

export async function createPartRequest(input: Omit<CreatePartRequestBody, 'photoKeys'> & { photos?: LocalPhoto[] }) {
  const { photos = [], ...body } = input;
  const photoKeys: string[] = [];
  for (const p of photos.slice(0, MAX_PHOTOS)) photoKeys.push(await uploadPhoto(p));
  const d = toPartRequestDetail(await partRequestApi.create({ ...body, photoKeys }));
  storeDetail(d);
  return d;
}

export async function cancelPartRequest(id: string) {
  const d = toPartRequestDetail(await partRequestApi.cancel(id));
  storeDetail(d);
  return d;
}

/**
 * Accepts a quote: the server creates a private offer only this customer can buy. It is merged into
 * the catalog lookups and added to the cart, so the normal cart → smart checkout flow takes over.
 */
export async function acceptQuote(requestId: string, quoteId: string) {
  const r = await partRequestApi.accept(requestId, quoteId);
  addPrivateCatalog(toPrivateCatalog({ products: [r.product], sellers: [r.seller] }, artFor));
  const store = useAppStore.getState();
  const existing = store.cart.find((l) => l.offerId === r.offerId);
  if (!existing) store.addToCart(r.offerId, r.quantity);
  fetchPartRequest(requestId).catch(() => {});
  return r;
}

/** Refreshes the private offers (accepted quotes). Offers still in the cart but gone server-side stay, flagged unavailable. */
export async function syncPrivateOffers() {
  if (!isRemote || !useAppStore.getState().user) return;
  const data = await partRequestApi.privateOffers();
  setPrivateCatalog(toPrivateCatalog(data, artFor), useAppStore.getState().cart.map((l) => l.offerId));
}

let watching = false;
/** Drops the private layer when the customer signs out. */
export function watchSignOut() {
  if (watching) return;
  watching = true;
  useAppStore.subscribe((s, prev) => {
    if (prev.user && !s.user) {
      clearPrivateCatalog();
      usePartRequests.setState({ list: [], listState: 'idle', byId: {} });
    }
  });
}
