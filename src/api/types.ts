/**
 * Wire types for the Qitah API (services/api). Money is integer halalas everywhere.
 * Kept deliberately loose where the server may add fields; adapters tolerate missing data.
 */

import type { L10n } from '@/domain/types';

export type ApiErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

// ── auth
export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number; tokenType: 'Bearer' };
export type OtpRequestResponse = { sent: boolean; channel: string; expiresInSeconds: number; sandboxCode?: string };
export type ApiUser = { id: string; phone: string | null; name: string | null; email?: string | null };
export type OtpVerifyResponse = TokenPair & { user: ApiUser };

// ── catalog
export type ApiCategory = { id: string; name: L10n; art: string };
export type ApiModel = { id: string; makeId: string; name: L10n; yearFrom: number; yearTo: number; trims: string[]; engines: string[] };
export type ApiMake = { id: string; name: L10n; models: ApiModel[] };
export type ReferenceResponse = { categories: ApiCategory[]; makes: ApiMake[] };

export type ApiOffer = {
  id: string;
  productId: string;
  sellerId: string;
  priceHalalas: number;
  compareAtHalalas: number | null;
  available: number;
  condition: string;
  warrantyMonths: number;
  dispatchDays: [number, number] | number[];
  originCity: string;
  noteAr: string | null;
  noteEn: string | null;
  updatedAt?: string;
  /** Only on `GET /v1/catalog/offers` (cart refresh). */
  purchasable?: boolean;
};

export type ApiFitment = { modelId: string; yearFrom: number; yearTo: number; engines?: string[]; source: 'catalog' | 'seller' | string };

export type ApiProduct = {
  id: string;
  name: L10n;
  description: L10n;
  categoryId: string;
  brand: string;
  origin: 'oem' | 'aftermarket' | string;
  partNumber: string;
  oemReferences: string[];
  specs: unknown;
  universal?: { note: L10n };
  fitment: ApiFitment[];
  art: string;
  keywords: string[];
  handling?: string;
  weightGrams?: number;
  rating: null;
  offers: ApiOffer[];
};

export type ApiSeller = {
  id: string;
  name: L10n;
  city: string;
  verifiedBusiness: boolean;
  joinedYear: number;
  rating: null;
  fulfilledOrders: number;
  onTimeRate: number | null;
  responseHours: number;
  supportsWorkshopDelivery: boolean;
  specialty: L10n;
  active?: boolean;
};

/** DEPRECATED (capped server-side); the app no longer calls it. */
export type SnapshotResponse = { generatedAt: string; products: ApiProduct[]; sellers: ApiSeller[] };

/** `GET /v1/catalog/products?ids=&offerIds=` (≤100) and `GET /v1/catalog/products/:id` share the product shape. */
export type ProductsResponse = { products: ApiProduct[]; sellers: ApiSeller[]; missing: string[] };
export type ProductDetailResponse = { product: ApiProduct; sellers: ApiSeller[] };
/** `GET /v1/catalog/home?modelId=&year=&engine=`: per-vehicle starter pack (≤24 products). */
export type HomeResponse = { vehicle: { modelId: string; year: number | null; engine: string | null } | null; recommended: string[]; featured: string[]; products: ApiProduct[]; sellers: ApiSeller[] };
/** `GET /v1/catalog/changes?since=&ids=` (≤100 ids): changed products in full + removed ids. */
export type ChangesResponse = { serverTime: string; since: string; products: ApiProduct[]; sellers: ApiSeller[]; removed: string[] };
export type SellerPageResponse = { seller: ApiSeller; products: ApiProduct[] };

/** `GET /v1/catalog/delivery-estimates` — estimates only; the checkout plan is binding. */
export type ApiServiceEstimate = { service: string; amountHalalas: number; etaDaysMin: number; etaDaysMax: number; arrivesBy: string };
export type ApiDeliveryEstimate = {
  offerId: string;
  originCity?: string;
  cheapest: ApiServiceEstimate | null;
  fastest: ApiServiceEstimate | null;
  sameDayAvailable: boolean;
  cutoffLocal: string;
};
export type DeliveryEstimatesResponse = { city: string; generatedAt: string; estimates: ApiDeliveryEstimate[] };

export type UploadTarget = { key: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresIn: number };

// ── search (GET /v1/catalog/search)
export type ApiSearchFit = 'catalogMatch' | 'sellerReported' | 'bySpecification' | 'noData' | 'noVehicle' | 'listedForModel' | 'listedForMake';
export type ApiSearchItem = ApiProduct & { match?: { fit: ApiSearchFit | string; group: 'fits' | 'other' | string; partNumber: boolean } };
export type ApiSearchVehicle = {
  source: 'query' | 'garage';
  makeId?: string;
  modelId?: string;
  year?: number;
  engine?: string;
  scope: 'vehicle' | 'model' | 'make';
  yearOutOfRange?: boolean;
  label?: L10n;
};
export type ApiSearchInterpretation = {
  query: string;
  partNumber: string | null;
  partNumbers: string[];
  concepts: { id: string; label: L10n; categoryId: string | null; carried: boolean; term: string }[];
  conceptGroups: string[][];
  freeTokens: string[];
  year: number | null;
  queryVehicle: { makeId: string; modelId: string | null; text: string } | null;
  vehicle: ApiSearchVehicle | null;
  withoutVehicle: string | null;
  unsupported: { id: string; label: L10n }[];
};
export type SearchResponse = {
  items: ApiSearchItem[];
  nextCursor: string | null;
  total: number;
  counts: { fits: number; other: number; hidden?: number };
  interpretation: ApiSearchInterpretation;
  didYouMean: string | null;
  fallback: { mode: 'corrected' | 'relaxed' | 'similar'; query?: string } | null;
  suggestions?: { categoryIds: string[] };
};
export type SearchQuery = {
  q?: string;
  modelId?: string;
  year?: number;
  engine?: string;
  fitsOnly?: boolean;
  categoryId?: string;
  origin?: string[];
  condition?: string[];
  inStock?: boolean;
  sort?: 'relevance' | 'priceAsc' | 'priceDesc' | 'fastest';
  cursor?: string;
  limit?: number;
};

// ── customer
export type ApiVehicle = { id: string; modelId: string; year: number; trim?: string; engine: string; vin?: string; odometerKm?: number; odometerUpdatedAt?: string; addedAt: number };

// ── garage: offline VIN decode
export type VinDecodeResponse = {
  valid: boolean;
  make?: { id: string; name: L10n };
  manufacturer?: string;
  modelYear?: number;
  wmi?: string;
  region?: string;
  checkDigit?: 'ok' | 'mismatch' | 'not_applicable';
  confidence: 'high' | 'medium' | 'low' | 'none';
  reasons: string[];
  note: string;
  noteAr: string;
};

// ── maintenance
export type ApiServiceStatus = 'due' | 'soon' | 'ok' | 'unknown';
export type ApiKitLine = {
  componentKey: string;
  component: L10n;
  productId: string;
  offerId: string;
  name: L10n;
  brand: string;
  partNumber: string;
  priceHalalas: number;
  available: number;
  quantity: number;
  fit: 'catalog' | 'universal';
};
export type ApiMaintenanceService = {
  serviceCode: string;
  templateId: string;
  name: L10n;
  note: L10n;
  intervalKm: number | null;
  intervalMonths: number | null;
  variants: { code: string; name: L10n; intervalKm: number }[];
  status: ApiServiceStatus;
  nextDueKm: number | null;
  nextDueAt: string | null;
  remainingKm: number | null;
  remainingDays: number | null;
  lastRecord: { id: string; doneAtKm: number | null; doneAt: string; variant: string | null; source: string } | null;
  kit: { lines: ApiKitLine[]; missing: { key: string; name: L10n }[]; totalHalalas: number };
};
export type ApiMaintenance = {
  vehicle: { id: string; modelId: string; year: number; engine: string; odometerKm: number | null; odometerUpdatedAt: string | null };
  disclaimer: L10n;
  services: ApiMaintenanceService[];
  proposals: { orderItemId: string; serviceCode: string; service: L10n; product: L10n; deliveredAt: string | null }[];
};
export type ServiceRecordInput = { serviceCode: string; doneAtKm?: number; doneAt?: string; variant?: string; orderItemId?: string };

// ── send to my mechanic
export type MechanicFit = 'catalog' | 'seller' | 'universal' | 'unverified' | 'no_vehicle';
export type ApiMechanicDecision = { offerId: string; decision: 'APPROVED' | 'ALTERNATIVE'; text?: string; partNumber?: string; alternativeOfferId?: string };
export type ApiMechanicLine = {
  offerId: string;
  productId: string;
  quantity: number;
  nameAr: string;
  nameEn: string;
  brand: string;
  partNumber: string;
  oemReferences: string[];
  origin: 'oem' | 'aftermarket';
  condition: string;
  warrantyMonths: number;
  sellerAr: string;
  sellerEn: string;
  fit: MechanicFit;
  alternatives: { offerId: string; condition: string; warrantyMonths: number; sellerAr: string; sellerEn: string; city: string }[];
  decision: ApiMechanicDecision | null;
};
export type ApiMechanicReview = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'CHANGES_SUGGESTED';
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  respondedAt: string | null;
  note: string | null;
  vehicle: { modelId: string; makeAr: string; makeEn: string; modelAr: string; modelEn: string; year: number; engine: string; vin: string | null } | null;
  lines: ApiMechanicLine[];
  mechanicNote: string | null;
  workshop: { name: string | null; phone: string | null } | null;
  approvedLines: { offerId: string; quantity: number }[];
  /** Only in the create response: the shareable link (the token is never stored in clear). */
  url?: string;
};
export type ApiAddress = {
  id: string;
  kind: 'home' | 'workshop' | string;
  label: string;
  city: string;
  district: string;
  street: string;
  details?: string;
  contactName: string;
  phone: string;
  workshopName?: string;
};
export type ApiCartLine = { offerId: string; qty: number };

// ── checkout
export type Strategy = 'selected' | 'lowest_total' | 'fastest' | 'fewest_shipments';

export type PlanLine = {
  offerId: string;
  originalOfferId: string;
  productId?: string;
  productNameAr?: string;
  productNameEn?: string;
  quantity: number;
  unitPriceHalalas: number;
};

export type PlanGroup = {
  merchantId: string;
  merchantNameAr: string;
  merchantNameEn: string;
  originCity: string;
  carrierCode: string;
  serviceCode: string;
  shippingHalalas: number;
  etaDaysMin: number;
  etaDaysMax: number;
  handling: string;
  lines: PlanLine[];
};

export type PlanOption = {
  planId: string;
  strategy: Strategy;
  bestFor: Strategy[];
  itemsHalalas: number;
  shippingHalalas: number;
  totalHalalas: number;
  vatHalalas: number;
  shipmentCount: number;
  etaDaysMax: number;
  sandboxRates: boolean;
  expiresAt: string;
  changes: { fromOfferId: string; toOfferId: string }[];
  groups: PlanGroup[];
};

export type PlanResponse = {
  options: PlanOption[];
  unavailable: string[];
  lines: { offerId: string; requested: number; selectedAvailable: number; alternatives: number }[];
};

export type RemotePaymentMethod = 'mada' | 'card' | 'applePay' | 'stcPay';
/** Checkout also accepts NET_TERMS for approved workshops (captured by the server against Qitah's internal credit). */
export type CheckoutPaymentMethod = RemotePaymentMethod | 'NET_TERMS';

export type PaymentInit = { id: string; redirectUrl: string | null; sandbox: boolean; status: string };

export type CheckoutResponse = { orderId: string; number: string; status: string; totalHalalas: number; payment: (PaymentInit & { method?: string }) | null; buyerOrgId?: string | null; workOrderRef?: string | null; creditDueAt?: string | null };

// ── orders
export type ServerOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'IN_FULFILLMENT'
  | 'PARTIALLY_SHIPPED'
  | 'SHIPPED'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PAYMENT_FAILED'
  | 'EXPIRED';

export type ServerMerchantOrderStatus =
  | 'PENDING_PAYMENT'
  | 'NEW'
  | 'ACCEPTED'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'HANDED_OVER'
  | 'DELIVERED'
  | 'REJECTED'
  | 'CANCELLED';

export type ServerShipmentStatus =
  | 'PENDING'
  | 'LABEL_CREATED'
  | 'PICKUP_SCHEDULED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'PICKUP_FAILED'
  | 'DELIVERY_FAILED'
  | 'EXCEPTION'
  | 'CANCELLED'
  | 'RETURNED_TO_SENDER';

export type ApiShipmentEvent = { status: ServerShipmentStatus | string; description: string | null; location: string | null; occurredAt: string };

export type ApiOrder = {
  id: string;
  number: string;
  status: ServerOrderStatus | string;
  sandbox: boolean;
  createdAt: string;
  paidAt: string | null;
  paymentExpiresAt: string;
  paymentMethod: string;
  address: Record<string, unknown> | null;
  vehicle: { label?: string; labelAr?: string; labelEn?: string; vin?: string | null } | null;
  totals: { itemsHalalas: number; shippingHalalas: number; discountHalalas: number; totalHalalas: number; vatHalalas: number; refundedHalalas: number };
  cancelReason: string | null;
  /** Workshop orders only (absent/null for retail). */
  buyerOrgId?: string | null;
  workOrderRef?: string | null;
  workshopQuoteId?: string | null;
  creditDueAt?: string | null;
  merchantOrders: {
    id: string;
    number: string;
    status: ServerMerchantOrderStatus | string;
    merchant: { id: string; nameAr: string; nameEn: string; city: string };
    itemsHalalas: number;
    shippingHalalas: number;
    deliveredAt: string | null;
  }[];
  items: {
    id: string;
    merchantOrderId: string;
    fulfillmentGroupId: string;
    offerId: string;
    productId: string;
    nameAr: string;
    nameEn: string;
    partNumber: string;
    condition: string;
    art: string;
    quantity: number;
    unitPriceHalalas: number;
    lineTotalHalalas: number;
    status: 'ACTIVE' | 'CANCELLED' | string;
    /** Server-computed fit at checkout; `guaranteed` = covered by ضمان قطعة. */
    fit?: { status: string; guaranteed: boolean } | null;
  }[];
  shipmentGroups: {
    id: string;
    merchantOrderId: string;
    serviceCode: string;
    carrierCode: string;
    shippingHalalas: number;
    etaDaysMin: number;
    etaDaysMax: number;
    originCity: string | null;
    shipment?: {
      id: string;
      status: ServerShipmentStatus | string;
      trackingNumber: string | null;
      sandbox: boolean;
      events: ApiShipmentEvent[];
    } | null;
  }[];
  payment: { id: string; status: string; method: string; sandbox: boolean; redirectUrl: string | null } | null;
  refunds: { id: string; amountHalalas: number; status: string; reason: string | null; createdAt: string }[];
  returns: {
    id: string;
    number: string;
    status: string;
    reason: string;
    refundHalalas: number;
    guaranteed?: boolean;
    autoApproved?: boolean;
    photoCount?: number;
    returnShipping?: { paidBy: 'CUSTOMER' | 'PLATFORM' | 'MERCHANT' | string; costHalalas: number; status: string; trackingNumber: string | null } | null;
    items: { orderItemId: string; quantity: number }[];
    createdAt: string;
  }[];
};

export type ApiNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type ApiDomainEvent = { id: string; type: string; entityType: string; entityId: string; orderId: string | null; payload: unknown; createdAt: string };
