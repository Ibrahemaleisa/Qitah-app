/**
 * Core marketplace domain model.
 *
 * The key separation: a `Product` is the canonical automotive part (one record per part),
 * while an `Offer` is a merchant's listing against that product. Many sellers can sell
 * the same product; customers compare offers, not duplicated product pages.
 */

export type Lang = 'ar' | 'en';
export type L10n = { ar: string; en: string };

// ---------------------------------------------------------------- vehicles

export type VehicleModel = {
  id: string;
  makeId: string;
  name: L10n;
  yearFrom: number;
  yearTo: number;
  trims: string[];
  engines: string[];
};

export type VehicleMake = {
  id: string;
  name: L10n;
  models: VehicleModel[];
};

/** A vehicle saved in the customer's garage. */
export type Vehicle = {
  id: string;
  makeId: string;
  modelId: string;
  year: number;
  /** Not used by fitment and no longer asked for; "" when unknown. */
  trim: string;
  engine: string;
  vin?: string;
  /** Last odometer reading the customer entered (km). */
  odometerKm?: number;
  addedAt: number;
};

// ---------------------------------------------------------------- catalog

export type CategoryId =
  | 'brakes'
  | 'filters'
  | 'oils'
  | 'engine'
  | 'suspension'
  | 'electrical'
  | 'lighting'
  | 'cooling'
  | 'body';

export type PartArtKind =
  | 'rotor'
  | 'pads'
  | 'oilFilter'
  | 'airFilter'
  | 'sparkPlug'
  | 'battery'
  | 'shock'
  | 'headlight'
  | 'radiator'
  | 'oil'
  | 'mirror'
  | 'belt'
  | 'alternator'
  | 'bumper'
  | 'pump';

export type Category = {
  id: CategoryId;
  name: L10n;
  art: PartArtKind;
};

/** Who made the part: the vehicle manufacturer (genuine OEM) or an aftermarket brand. */
export type PartOrigin = 'oem' | 'aftermarket';

/** The physical condition of a specific seller's unit. */
export type Condition = 'new' | 'used' | 'refurbished';

/**
 * Where a fitment claim comes from. Only `catalog` entries are treated as catalog-backed;
 * `seller` entries are shown as unverified seller-reported fitment.
 */
export type FitmentSource = 'catalog' | 'seller';

export type Fitment = {
  modelId: string;
  yearFrom: number;
  yearTo: number;
  /** When set, the fitment applies only to these engine specifications. */
  engines?: string[];
  source: FitmentSource;
};

export type RatingSummary = {
  average: number;
  count: number;
  /** Share of ratings attached to a verified purchase, 0..1. */
  verifiedShare: number;
  /** Counts for 5,4,3,2,1 stars. */
  distribution: [number, number, number, number, number];
};

export type Spec = { label: L10n; value: L10n | string };

export type Product = {
  id: string;
  name: L10n;
  categoryId: CategoryId;
  brand: string;
  origin: PartOrigin;
  /** Manufacturer part number, plus any OEM cross-reference numbers. */
  partNumber: string;
  oemReferences: string[];
  description: L10n;
  specs: Spec[];
  /** Fits by specification rather than by vehicle (oil, bulbs, batteries by group size). */
  universal?: { note: L10n };
  fitment: Fitment[];
  art: PartArtKind;
  keywords: string[];
  /** Product quality & experience ratings (separate from seller service ratings). */
  rating: RatingSummary | null;
};

export type Seller = {
  id: string;
  name: L10n;
  city: CityId;
  verifiedBusiness: boolean;
  joinedYear: number;
  /** Seller service & reliability ratings. Null for sellers without enough ratings. */
  rating: RatingSummary | null;
  fulfilledOrders: number;
  onTimeRate: number | null;
  responseHours: number;
  supportsWorkshopDelivery: boolean;
  freeShippingOver?: number;
  specialty: L10n;
};

export type DeliveryOptionId = 'standard' | 'express' | 'sameDay' | 'freight';

export type DeliveryOption = {
  id: DeliveryOptionId;
  name: L10n;
  carrier: L10n;
  etaDays: [number, number];
  fee: number;
  /** Same-day is only offered when the seller and destination are in the same city. */
  sameCityOnly?: boolean;
};

export type Offer = {
  id: string;
  productId: string;
  sellerId: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  condition: Condition;
  warrantyMonths: number;
  dispatchDays: [number, number];
  deliveryOptions: DeliveryOptionId[];
  note?: L10n;
  /** Remote mode: the pickup location this offer ships from (a merchant may have several). */
  originCity?: CityId;
  /** Remote mode: the offer exists but can no longer be bought (paused, merchant suspended…). */
  unavailable?: boolean;
};

export type Review = {
  id: string;
  target: { kind: 'product'; productId: string } | { kind: 'seller'; sellerId: string };
  rating: number;
  author: string;
  daysAgo: number;
  body: L10n;
  verifiedPurchase: boolean;
};

// ---------------------------------------------------------------- customers

export type CityId = 'riyadh' | 'jeddah' | 'dammam' | 'khobar' | 'makkah' | 'madinah';

export type DeliveryDestination = 'home' | 'workshop';

export type Address = {
  id: string;
  kind: DeliveryDestination;
  label: string;
  city: CityId;
  district: string;
  street: string;
  details?: string;
  contactName: string;
  phone: string;
  workshopName?: string;
};

/**
 * `seenPrice` (SAR) is the unit price the customer saw when adding the line. In remote mode it is
 * compared with the live price so a price change is shown before checkout.
 */
export type CartLine = { offerId: string; qty: number; seenPrice?: number };

// ---------------------------------------------------------------- orders

export type PaymentMethodId = 'applePay' | 'mada' | 'card' | 'stcPay' | 'tabby' | 'tamara';

export type ShipmentStage =
  | 'placed'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'outForDelivery'
  | 'delivered';

export type OrderLine = {
  id: string;
  offerId: string;
  productId: string;
  sellerId: string;
  qty: number;
  unitPrice: number;
  condition: Condition;
  /** Snapshots so the order stays readable if catalog data changes. */
  productName: L10n;
  art: PartArtKind;
};

export type Shipment = {
  id: string;
  sellerId: string;
  lineIds: string[];
  deliveryOptionId: DeliveryOptionId;
  fee: number;
  trackingNumber: string;
  /** Simulation: minutes after order creation at which each stage is reached. */
  stageOffsetsMin: Record<Exclude<ShipmentStage, 'placed'>, number>;
};

export type ReturnReason = 'wrongPart' | 'damaged' | 'notAsDescribed' | 'changedMind';

export type ReturnRequest = {
  id: string;
  lineId: string;
  reason: ReturnReason;
  createdAt: number;
};

export type Order = {
  id: string;
  number: string;
  createdAt: number;
  lines: OrderLine[];
  shipments: Shipment[];
  address: Address;
  vehicleLabel?: string;
  payment: { methodId: PaymentMethodId; simulated: true; reference: string };
  totals: { items: number; shipping: number; total: number; vat: number };
  cancellation?: { requestedAt: number; reason: string };
  returns: ReturnRequest[];
  /** True for the pre-seeded demonstration order. */
  isSample?: boolean;
};
