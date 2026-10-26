/* Response shapes of the Qitah API (services/api/src/routes/ops.ts). Dates arrive as ISO strings. */

export type PlatformRole = 'OPS_AGENT' | 'OPS_ADMIN' | 'FINANCE';

export type Me = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  platformRoles: PlatformRole[];
  merchants: { id: string; role: string; displayNameAr: string; status: string }[];
};

export type MerchantStatus = 'APPLIED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type OrderStatus =
  | 'PENDING_PAYMENT' | 'PAID' | 'IN_FULFILLMENT' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'PARTIALLY_DELIVERED'
  | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'PAYMENT_FAILED' | 'EXPIRED';
export type MerchantOrderStatus = 'PENDING_PAYMENT' | 'NEW' | 'ACCEPTED' | 'PACKING' | 'READY_FOR_PICKUP' | 'HANDED_OVER' | 'DELIVERED' | 'REJECTED' | 'CANCELLED';
export type ShipmentStatus =
  | 'PENDING' | 'LABEL_CREATED' | 'PICKUP_SCHEDULED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED'
  | 'PICKUP_FAILED' | 'DELIVERY_FAILED' | 'EXCEPTION' | 'CANCELLED' | 'RETURNED_TO_SENDER';
export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'IN_TRANSIT' | 'RECEIVED' | 'REFUNDED' | 'CLOSED';
export type Direction = 'OUTBOUND' | 'RETURN';

export type Summary = {
  pendingMerchants: number;
  approvedMerchants: number;
  ordersToday: number;
  awaitingAcceptance: number;
  readyForPickup: number;
  activeShipments: number;
  exceptions: number;
  openReturns: number;
  pendingRefunds: number;
  slaBreaches: number;
  sandbox: boolean;
};

export type Notification = { id: string; type: string; title: string; body: string; data: Record<string, unknown>; createdAt: string; readAt: string | null };

export type PickupLocation = { id: string; name: string; city: string; district: string; street: string; contactPhone: string; active: boolean };

export type Merchant = {
  id: string;
  legalName: string;
  displayNameAr: string;
  displayNameEn: string;
  crNumber: string;
  vatNumber: string | null;
  city: string;
  specialtyAr: string;
  specialtyEn: string;
  contactEmail: string;
  contactPhone: string;
  status: MerchantStatus;
  commissionBps: number;
  supportsWorkshopDelivery: boolean;
  slaAcceptMinutes: number;
  slaReadyMinutes: number;
  statusReason: string | null;
  approvedAt: string | null;
  createdAt: string;
  _count: { offers: number; locations?: number; merchantOrders: number };
};

export type Verification = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  documents: { type?: string; reference?: string; fileKey?: string }[];
  notes: string | null;
  reviewNote: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type MerchantDetail = Merchant & {
  verifications: Verification[];
  locations: PickupLocation[];
  members: { id: string; role: string; status: string; createdAt: string; user: { id: string; name: string | null; email: string | null; phone: string | null } }[];
  orderStats: { status: MerchantOrderStatus; _count: number }[];
  balance: { payableHalalas: number; commissionHalalas: number; paidOutHalalas: number };
};

export type Address = { city?: string; district?: string; street?: string; details?: string | null; contactName?: string; phone?: string; kind?: string; label?: string; workshopName?: string | null };

export type MerchantOrder = {
  id: string;
  number: string;
  orderId: string;
  merchantId: string;
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
  merchant: { id: string; displayNameAr: string; displayNameEn?: string; city: string };
};

export type OrderItem = {
  id: string;
  merchantOrderId: string;
  fulfillmentGroupId: string;
  productNameAr: string;
  partNumber: string;
  condition: string;
  quantity: number;
  unitPriceHalalas: number;
  lineTotalHalalas: number;
  status: 'ACTIVE' | 'CANCELLED';
};

export type FulfillmentGroup = {
  id: string;
  merchantOrderId: string;
  originLocationId: string;
  carrierCode: string;
  serviceCode: string;
  quotedHalalas: number;
  etaDaysMin: number;
  etaDaysMax: number;
  weightGrams: number;
  handling: string;
};

export type ShipmentEvent = { id: string; status: ShipmentStatus; description: string; location: string | null; source: 'CARRIER' | 'OPS' | 'MERCHANT' | 'SYSTEM'; occurredAt: string; actorUserId: string | null };

export type Shipment = {
  id: string;
  orderId: string;
  merchantOrderId: string;
  fulfillmentGroupId: string | null;
  returnCaseId: string | null;
  originLocationId: string;
  direction: Direction;
  carrierCode: string;
  serviceCode: string;
  sandbox: boolean;
  status: ShipmentStatus;
  trackingNumber: string | null;
  labelUrl: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  weightGrams: number;
  costHalalas: number;
  exceptionReason: string | null;
  createdAt: string;
  updatedAt: string;
  events: ShipmentEvent[];
};

export type PaymentEvent = { id: string; provider: string; providerEventId: string; paymentId: string | null; type: string; payload: Record<string, unknown>; outcome: string; createdAt: string };

export type Payment = {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  status: string;
  method: string;
  amountHalalas: number;
  capturedHalalas: number;
  refundedHalalas: number;
  sandbox: boolean;
  failureReason: string | null;
  createdAt: string;
  events: PaymentEvent[];
};

export type Allocation = { merchantId: string; merchantOrderId: string; items: number; commission: number; shipping: number };

export type Refund = {
  id: string;
  paymentId: string;
  orderId: string;
  returnCaseId: string | null;
  amountHalalas: number;
  reason: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  providerRefundId: string | null;
  allocation: Allocation[];
  failureReason: string | null;
  createdAt: string;
};

export type ReturnCase = {
  id: string;
  number: string;
  orderId: string;
  merchantOrderId: string;
  merchantId: string;
  status: ReturnStatus;
  reason: string;
  customerNote: string | null;
  decisionNote: string | null;
  inspectionNote: string | null;
  restock: boolean;
  refundHalalas: number;
  createdAt: string;
  updatedAt: string;
};

export type LedgerEntry = {
  id: string;
  postingId: string;
  postingType: string;
  account: string;
  amountHalalas: number;
  merchantId: string | null;
  merchantOrderId: string | null;
  refType: string;
  refId: string;
  createdAt: string;
};

export type AuditEvent = { id: string; actorUserId: string | null; actorType: string; merchantId: string | null; action: string; entityType: string; entityId: string; data: unknown; createdAt: string };

export type Reconciliation = {
  orderId: string;
  number: string;
  status: OrderStatus;
  capturedHalalas: number;
  refundedHalalas: number;
  netCollectedHalalas: number;
  ledger: Record<string, number>;
  reconciled: boolean;
  issues: string[];
};

export type OrderTrace = {
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    addressSnapshot: Address;
    vehicleSnapshot: { label?: string } | null;
    paymentMethod: string;
    itemsHalalas: number;
    shippingHalalas: number;
    discountHalalas: number;
    totalHalalas: number;
    vatHalalas: number;
    refundedHalalas: number;
    sandbox: boolean;
    paymentExpiresAt: string;
    paidAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    createdAt: string;
    customer: { id: string; name: string | null; phone: string | null };
    merchantOrders: MerchantOrder[];
    items: OrderItem[];
    groups: FulfillmentGroup[];
    shipments: (Shipment & { originLocation: { city: string; name: string } })[];
    payments: Payment[];
    refunds: Refund[];
    returnCases: (ReturnCase & { items: { orderItemId: string; quantity: number }[] })[];
    ledgerEntries: LedgerEntry[];
  };
  auditTrail: AuditEvent[];
  reconciliation: Reconciliation;
};

export type OrderListItem = {
  id: string;
  number: string;
  status: OrderStatus;
  totalHalalas: number;
  createdAt: string;
  customer: { id: string; name: string | null; phone: string | null };
  merchantOrders: { id: string; number: string; status: MerchantOrderStatus; merchant: { displayNameAr: string } }[];
};

export type QueueItem = MerchantOrder & {
  order: { id: string; number: string; addressSnapshot: Address };
  groups: (FulfillmentGroup & { originLocation: { name: string; city: string } })[];
  shipments: Shipment[];
  items: { productNameAr: string; quantity: number }[];
  slaDueAt: string | null;
  slaMinutesLeft: number | null;
};

export type ShipmentListItem = Shipment & {
  originLocation: { id: string; name: string; city: string; district: string };
  merchantOrder: { id: string; number: string; status: MerchantOrderStatus; merchant: { id: string; displayNameAr: string } };
  order: { id: string; number: string; addressSnapshot: Address };
};

export type ShipmentDetail = Shipment & {
  originLocation: PickupLocation;
  merchantOrder: MerchantOrder & { merchant: Merchant; items: OrderItem[] };
  order: { id: string; number: string; addressSnapshot: Address; status: OrderStatus };
  group: FulfillmentGroup | null;
  returnCase: ReturnCase | null;
};

export type Exceptions = {
  shipments: (Shipment & { merchantOrder: { number: string; merchant: { displayNameAr: string } }; order: { number: string } })[];
  delayedPickups: (Shipment & { merchantOrder: { number: string; merchant: { displayNameAr: string } } })[];
  slaBreaches: (MerchantOrder & { merchant: { displayNameAr: string } })[];
  failedRefunds: (Refund & { order: { number: string } })[];
  flaggedPayments: PaymentEvent[];
};

export type ReturnListItem = ReturnCase & {
  items: { id: string; quantity: number; orderItem: OrderItem }[];
  merchant: { displayNameAr: string };
  order: { number: string };
  shipments: Shipment[];
  refunds: Refund[];
};

export type Settlement = {
  id: string;
  merchantId: string;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
  grossHalalas: number;
  commissionHalalas: number;
  refundsHalalas: number;
  netHalalas: number;
  payoutReference: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  merchant: { displayNameAr: string };
  lines: { id: string; merchantOrderId: string; netHalalas: number }[];
};

export type Eligibility = {
  merchantId: string;
  displayNameAr: string;
  eligibleOrders: number;
  eligibleNetHalalas: number;
  balance: { payableHalalas: number; commissionHalalas: number; paidOutHalalas: number };
};

export type LiveEvent = { id: string; type: string; entityType: string; entityId: string; orderId: string | null; payload: Record<string, unknown>; createdAt: string };
