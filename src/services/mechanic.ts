import { create } from 'zustand';

import { mechanicApi } from '@/api/endpoints';
import type { ApiMechanicLine, ApiMechanicReview, MechanicFit } from '@/api/types';
import { isRemote } from '@/config/env';
import { getProduct } from '@/data/catalog';
import { getOffer, offersForProduct } from '@/data/offers';
import { getMake, getModel } from '@/data/vehicles';
import { getFitStatus, type FitStatus } from '@/domain/compatibility';
import { getSeller } from '@/domain/pricing';
import type { Vehicle } from '@/domain/types';
import type { Strings } from '@/i18n/ar';
import { makeId } from '@/lib/id';
import { isLocalId } from '@/services/remote/account';
import { useAppStore } from '@/store/app-store';

/**
 * "أرسل لميكانيكي" on the device.
 * - Remote: the server creates the review and the public link (POST /v1/me/mechanic-reviews); the link is
 *   kept on the device to re-share (the server only stores the token's hash).
 * - Demo: a local, clearly-labelled sample review; the mechanic's answer can be simulated.
 */

export type MechanicReview = ApiMechanicReview;

export const useMechanicReviews = create<{ byId: Record<string, MechanicReview>; order: string[] }>()(() => ({ byId: {}, order: [] }));

function store(r: MechanicReview) {
  useMechanicReviews.setState((s) => ({ byId: { ...s.byId, [r.id]: r }, order: s.order.includes(r.id) ? s.order : [r.id, ...s.order] }));
}

export const requiresSignIn = () => isRemote && !useAppStore.getState().user;

const FIT_MAP: Record<FitStatus, MechanicFit> = { catalogMatch: 'catalog', sellerReported: 'seller', bySpecification: 'universal', noData: 'unverified', noVehicle: 'no_vehicle' };

function localReview(lines: { offerId: string; qty: number }[], vehicle: Vehicle | undefined, note: string | undefined): MechanicReview {
  const model = vehicle ? getModel(vehicle.modelId) : undefined;
  const make = model ? getMake(model.makeId) : undefined;
  const now = Date.now();
  const id = makeId('mr');
  const reviewLines: ApiMechanicLine[] = lines.flatMap(({ offerId, qty }) => {
    const offer = getOffer(offerId);
    const product = offer ? getProduct(offer.productId) : undefined;
    if (!offer || !product) return [];
    const seller = getSeller(offer.sellerId);
    return [
      {
        offerId,
        productId: product.id,
        quantity: qty,
        nameAr: product.name.ar,
        nameEn: product.name.en,
        brand: product.brand,
        partNumber: product.partNumber,
        oemReferences: product.oemReferences.filter((r) => r !== product.partNumber),
        origin: product.origin,
        condition: offer.condition.toUpperCase(),
        warrantyMonths: offer.warrantyMonths,
        sellerAr: seller?.name.ar ?? '',
        sellerEn: seller?.name.en ?? '',
        fit: FIT_MAP[getFitStatus(product, vehicle)],
        alternatives: offersForProduct(product.id)
          .filter((o) => o.id !== offerId && o.stock > 0)
          .slice(0, 5)
          .map((o) => ({ offerId: o.id, condition: o.condition.toUpperCase(), warrantyMonths: o.warrantyMonths, sellerAr: getSeller(o.sellerId)?.name.ar ?? '', sellerEn: getSeller(o.sellerId)?.name.en ?? '', city: o.originCity ?? getSeller(o.sellerId)?.city ?? '' })),
        decision: null,
      },
    ];
  });
  return {
    id,
    status: 'PENDING',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 72 * 3600_000).toISOString(),
    expired: false,
    respondedAt: null,
    note: note?.trim() || null,
    vehicle: vehicle && model && make ? { modelId: model.id, makeAr: make.name.ar, makeEn: make.name.en, modelAr: model.name.ar, modelEn: model.name.en, year: vehicle.year, engine: vehicle.engine, vin: vehicle.vin ?? null } : null,
    lines: reviewLines,
    mechanicNote: null,
    workshop: null,
    approvedLines: [],
    url: `https://qitah.app/m/demo-${id}`,
  };
}

export async function createReview(input: { lines: { offerId: string; qty: number }[]; vehicle?: Vehicle; note?: string }): Promise<MechanicReview> {
  if (!isRemote) {
    const r = localReview(input.lines, input.vehicle, input.note);
    store(r);
    useAppStore.getState().saveMechanicLink(r.id, r.url!);
    return r;
  }
  const r = await mechanicApi.create({
    lines: input.lines.map((l) => ({ offerId: l.offerId, quantity: Math.min(20, l.qty) })),
    ...(input.vehicle && !isLocalId(input.vehicle.id) ? { vehicleId: input.vehicle.id } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  });
  store(r);
  if (r.url) useAppStore.getState().saveMechanicLink(r.id, r.url);
  return r;
}

export async function fetchReviews() {
  if (!isRemote) return;
  const { reviews } = await mechanicApi.list();
  useMechanicReviews.setState((s) => ({ byId: { ...s.byId, ...Object.fromEntries(reviews.map((r) => [r.id, r])) }, order: reviews.map((r) => r.id) }));
}

export async function fetchReview(id: string) {
  if (!isRemote) return useMechanicReviews.getState().byId[id];
  const r = await mechanicApi.get(id);
  store(r);
  return r;
}

/** Demo only: what the customer sees once a mechanic approves everything. */
export function simulateMechanicApproval(id: string, workshopName: string) {
  const r = useMechanicReviews.getState().byId[id];
  if (!r || isRemote) return;
  const lines = r.lines.map((l) => ({ ...l, decision: { offerId: l.offerId, decision: 'APPROVED' as const } }));
  store({ ...r, status: 'APPROVED', respondedAt: new Date().toISOString(), lines, workshop: { name: workshopName, phone: null }, approvedLines: lines.map((l) => ({ offerId: l.offerId, quantity: l.quantity })) });
}

/** WhatsApp-friendly share text (Arabic by default, as the mechanic reads Arabic). */
export function shareMessage(s: Strings, review: Pick<MechanicReview, 'vehicle' | 'lines'>, url: string): string {
  const v = review.vehicle ? `${review.vehicle.makeAr} ${review.vehicle.modelAr} ${review.vehicle.year}` : '';
  return s.mechanic.shareText(v, review.lines.length, url);
}

/** Lines that can be added to the cart: what the mechanic approved (or the same-product offer they picked). */
export function cartLinesFor(review: Pick<MechanicReview, 'approvedLines'>): { offerId: string; qty: number }[] {
  return review.approvedLines.map((l) => ({ offerId: l.offerId, qty: l.quantity }));
}
