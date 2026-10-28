/**
 * Server-side fit evaluation for the fit guarantee ("ضمان قطعة").
 *
 * Mirrors the app's conservative rules: only CATALOG-sourced fitment counts as a verified match,
 * seller-reported fitment is surfaced but never guaranteed, and nothing is inferred. A by-specification
 * (universal) product is guaranteed to match its stated specification regardless of vehicle.
 * The client's own fit claim is never an input here.
 */

export type FitStatus = 'catalogMatch' | 'sellerReported' | 'bySpecification' | 'noData';

export type FitmentRow = { id: string; modelId: string; yearFrom: number; yearTo: number; engines: string[]; source: 'CATALOG' | 'SELLER' };
export type FitProduct = { universalNoteAr: string | null; fitments: FitmentRow[] };
export type FitVehicleSpec = { modelId: string; year: number; engine: string };

export type FitResult = { status: FitStatus; guaranteed: boolean; fitmentIds: string[] };

export function fitmentApplies(f: FitmentRow, v: FitVehicleSpec): boolean {
  return f.modelId === v.modelId && v.year >= f.yearFrom && v.year <= f.yearTo && (f.engines.length === 0 || f.engines.includes(v.engine));
}

export function evaluateFit(product: FitProduct, vehicle: FitVehicleSpec | null | undefined): FitResult {
  if (product.universalNoteAr) return { status: 'bySpecification', guaranteed: true, fitmentIds: [] };
  if (!vehicle) return { status: 'noData', guaranteed: false, fitmentIds: [] };
  const matches = product.fitments.filter((f) => fitmentApplies(f, vehicle));
  const catalog = matches.filter((f) => f.source === 'CATALOG');
  if (catalog.length) return { status: 'catalogMatch', guaranteed: true, fitmentIds: catalog.map((f) => f.id).sort() };
  const seller = matches.filter((f) => f.source === 'SELLER');
  if (seller.length) return { status: 'sellerReported', guaranteed: false, fitmentIds: seller.map((f) => f.id).sort() };
  return { status: 'noData', guaranteed: false, fitmentIds: [] };
}

/** Vehicle as recorded on the order and on each line's fit snapshot. */
export type VehicleSnapshot = {
  garageVehicleId: string;
  makeId: string;
  modelId: string;
  year: number;
  trim: string;
  engine: string;
  vin: string | null;
  label: string;
  labelAr: string;
  labelEn: string;
};

export type FitSnapshot = FitResult & { vehicle: VehicleSnapshot | null; vin: string | null; evaluatedAt: string };

export function readFitSnapshot(json: unknown): FitSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  const s = json as Partial<FitSnapshot>;
  if (typeof s.status !== 'string' || typeof s.guaranteed !== 'boolean') return null;
  return s as FitSnapshot;
}

/** Lines whose fit the merchant should double-check (seller claim or no fitment data at all). */
export const needsMerchantConfirmation = (snap: FitSnapshot | null) => !!snap && (snap.status === 'sellerReported' || snap.status === 'noData');
