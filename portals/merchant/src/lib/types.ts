/** Shapes returned by the Qitah API (services/api/src/routes/*.ts). Only the fields the portal uses. */

export type MerchantRole = "OWNER" | "MANAGER" | "STAFF";
export type MerchantStatus = "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type Me = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  platformRoles: string[];
  merchants: { id: string; role: MerchantRole; displayNameAr: string; displayNameEn: string; status: MerchantStatus }[];
};

export type Location = {
  id: string;
  merchantId: string;
  name: string;
  city: string;
  district: string;
  street: string;
  contactPhone: string;
  latitude: number | null;
  longitude: number | null;
  /** Same-day cutoff, minutes after midnight Riyadh time (default 840 = 14:00). */
  sameDayCutoffMinutes?: number;
  active: boolean;
  createdAt: string;
};

export type Verification = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  documents: { type: string; reference: string; fileKey?: string }[];
  notes: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type MerchantProfile = {
  id: string;
  legalName: string;
  displayNameAr: string;
  displayNameEn: string;
  crNumber: string;
  vatNumber: string | null;
  city: string;
  specialtyAr: string;
  contactEmail: string;
  contactPhone: string;
  status: MerchantStatus;
  statusReason: string | null;
  commissionBps: number;
  slaAcceptMinutes: number;
  slaReadyMinutes: number;
  approvedAt: string | null;
  createdAt: string;
  verifications: Verification[];
  locations: Location[];
  myRole: MerchantRole;
};

export type Dashboard = {
  queue: { new: number; accepted: number; packing: number; readyForPickup: number; handedOver: number };
  openReturns: number;
  lowStockOffers: number;
  activeOffers: number;
  performance: { deliveredOrders: number; slaBreaches: number; rejectionRate: number | null };
  balance: { payableHalalas: number; commissionHalalas: number; paidOutHalalas: number };
};

export type MerchantOrderStatus =
  | "PENDING_PAYMENT"
  | "NEW"
  | "ACCEPTED"
  | "PACKING"
  | "READY_FOR_PICKUP"
  | "HANDED_OVER"
  | "DELIVERED"
  | "REJECTED"
  | "CANCELLED";

export type OrderItem = {
  id: string;
  offerId: string;
  productId: string;
  quantity: number;
  unitPriceHalalas: number;
  lineTotalHalalas: number;
  productNameAr: string;
  productNameEn: string;
  partNumber: string;
  condition: "NEW" | "USED" | "REFURBISHED";
  status: "ACTIVE" | "CANCELLED";
  /** Server-computed at checkout (never the customer's claim). */
  fit?: FitInfo | null;
  /** Seller-reported or unknown fit: double-check before packing. */
  fitNeedsConfirmation?: boolean;
};

export type FitStatus = "catalogMatch" | "sellerReported" | "bySpecification" | "noData";

export type OrderVehicle = { garageVehicleId: string; modelId: string; year: number; trim: string; engine: string; vin: string | null; label: string; labelAr: string; labelEn: string };

export type FitInfo = { status: FitStatus; guaranteed: boolean; vehicle: OrderVehicle | null; vin: string | null };

export type ShipmentEvent = { id: string; status: string; description: string; location: string | null; source: string; occurredAt: string };

export type Shipment = {
  id: string;
  direction: "OUTBOUND" | "RETURN";
  carrierCode: string;
  serviceCode: string;
  sandbox: boolean;
  status: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  weightGrams: number;
  costHalalas?: number;
  /** Who bears the carrier cost (return shipments: Qitah under the fit guarantee, the merchant, or the customer). */
  paidBy?: "CUSTOMER" | "PLATFORM" | "MERCHANT";
  exceptionReason: string | null;
  createdAt: string;
  events: ShipmentEvent[];
};

export type Address = {
  kind?: string;
  city?: string;
  district?: string;
  street?: string;
  details?: string;
  contactName?: string;
  phone?: string;
  workshopName?: string;
  label?: string;
};

export type MerchantOrder = {
  id: string;
  number: string;
  orderId: string;
  status: MerchantOrderStatus;
  itemsHalalas: number;
  shippingHalalas: number;
  commissionBps: number;
  commissionHalalas: number;
  acceptBy: string | null;
  readyBy: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  handedOverAt: string | null;
  deliveredAt: string | null;
  rejectedReason: string | null;
  slaBreached: boolean;
  createdAt: string;
  items: OrderItem[];
  order: { id: string; number: string; addressSnapshot: Address; createdAt: string; paidAt: string | null; status: string };
  groups: { id: string; carrierCode: string; serviceCode: string; etaDaysMin: number; etaDaysMax: number; originLocation: { id: string; name: string; city: string } }[];
  shipments: Shipment[];
  returnCases: { id: string; number: string; status: string }[];
  /** The customer's vehicle (with VIN) chosen at checkout. */
  vehicle?: OrderVehicle | null;
  fitNeedsConfirmation?: boolean;
};

export type Paged<T> = { total: number; items: T[] };

export type Offer = {
  id: string;
  productId: string;
  locationId: string;
  sku: string;
  condition: "NEW" | "USED" | "REFURBISHED";
  priceHalalas: number;
  compareAtHalalas: number | null;
  warrantyMonths: number;
  dispatchDaysMin: number;
  dispatchDaysMax: number;
  noteAr: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  updatedAt: string;
  product: { id: string; nameAr: string; nameEn: string; partNumber: string; brand: string; categoryId: string };
  inventory: { onHand: number; reserved: number } | null;
  location: { id: string; name: string; city: string };
};

export type Adjustment = { id: string; delta: number; onHandAfter: number; reason: string; note: string | null; refType: string | null; createdAt: string };

export type CatalogProduct = {
  id: string;
  nameAr: string;
  nameEn: string;
  brand: string;
  origin: "OEM" | "AFTERMARKET";
  partNumber: string;
  categoryId: string;
  status: string;
  category?: { id: string; nameAr: string; nameEn: string };
  identifiers: { type: string; value: string }[];
  fitments: { id: string; modelId: string; yearFrom: number; yearTo: number; engines: string[]; source: "CATALOG" | "SELLER" }[];
};

export type Reference = {
  categories: { id: string; name: { ar: string; en: string } }[];
  makes: {
    id: string;
    name: { ar: string; en: string };
    models: { id: string; makeId: string; name: { ar: string; en: string }; yearFrom: number; yearTo: number; trims: string[]; engines: string[] }[];
  }[];
};

export type StaffMember = {
  id: string;
  role: MerchantRole;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  user: { id: string; name: string | null; email: string | null; phone: string | null };
};

export type ReturnCase = {
  id: string;
  number: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "IN_TRANSIT" | "RECEIVED" | "REFUNDED" | "CLOSED";
  reason: string;
  customerNote: string | null;
  decisionNote: string | null;
  inspectionNote: string | null;
  restock: boolean;
  refundHalalas: number;
  createdAt: string;
  merchantOrder: { number: string };
  items: { id: string; quantity: number; orderItem: OrderItem; fit?: FitInfo | null }[];
  shipments: Shipment[];
  refunds: { id: string; amountHalalas: number; status: string }[];
  /** ضمان قطعة: wrong-part claim on guaranteed lines — auto-approved, Qitah pays return shipping. */
  guaranteed?: boolean;
  unopened?: boolean;
  /** Signed, short-lived photo URLs (damaged claims). */
  photos?: { key: string; url: string }[];
  returnShipping?: { id: string; status: string; costHalalas: number; paidBy: "CUSTOMER" | "PLATFORM" | "MERCHANT" }[];
};

export type Settlement = {
  id: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  grossHalalas: number;
  commissionHalalas: number;
  refundsHalalas: number;
  netHalalas: number;
  payoutReference: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  lines: { id: string; grossHalalas: number; commissionHalalas: number; refundsHalalas: number; netHalalas: number; merchantOrder: { number: string } }[];
};

export type Notification = { id: string; type: string; title: string; body: string; data: Record<string, unknown>; readAt: string | null; createdAt: string };

export type AuditEvent = { id: string; actorType: string; actorUserId: string | null; action: string; entityType: string; entityId: string; data: unknown; createdAt: string };

export type DomainEvent = { id: string; type: string; entityType: string; entityId: string; orderId: string | null; payload: Record<string, unknown>; createdAt: string };
