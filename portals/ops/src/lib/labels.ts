/** Arabic labels and consistent status tones used by every status chip in the portal. */
export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';
type Entry = [label: string, tone: Tone];

const ORDER: Record<string, Entry> = {
  PENDING_PAYMENT: ['بانتظار الدفع', 'neutral'],
  PAID: ['مدفوع', 'info'],
  IN_FULFILLMENT: ['قيد التجهيز', 'progress'],
  PARTIALLY_SHIPPED: ['شُحن جزئياً', 'progress'],
  SHIPPED: ['تم الشحن', 'progress'],
  PARTIALLY_DELIVERED: ['سُلّم جزئياً', 'progress'],
  DELIVERED: ['تم التسليم', 'success'],
  COMPLETED: ['مكتمل', 'success'],
  CANCELLED: ['ملغي', 'neutral'],
  PAYMENT_FAILED: ['فشل الدفع', 'danger'],
  EXPIRED: ['منتهي', 'neutral'],
};

const MERCHANT_ORDER: Record<string, Entry> = {
  PENDING_PAYMENT: ['بانتظار الدفع', 'neutral'],
  NEW: ['جديد', 'warning'],
  ACCEPTED: ['مقبول', 'info'],
  PACKING: ['قيد التغليف', 'progress'],
  READY_FOR_PICKUP: ['جاهز للاستلام', 'info'],
  HANDED_OVER: ['سُلّم للناقل', 'progress'],
  DELIVERED: ['تم التسليم', 'success'],
  REJECTED: ['مرفوض', 'danger'],
  CANCELLED: ['ملغي', 'neutral'],
};

const SHIPMENT: Record<string, Entry> = {
  PENDING: ['بانتظار البوليصة', 'warning'],
  LABEL_CREATED: ['أُنشئت البوليصة', 'info'],
  PICKUP_SCHEDULED: ['موعد استلام محدد', 'info'],
  PICKED_UP: ['استلمها الناقل', 'progress'],
  IN_TRANSIT: ['في الطريق', 'progress'],
  OUT_FOR_DELIVERY: ['خرجت للتسليم', 'progress'],
  DELIVERED: ['تم التسليم', 'success'],
  PICKUP_FAILED: ['فشل الاستلام', 'danger'],
  DELIVERY_FAILED: ['فشل التسليم', 'danger'],
  EXCEPTION: ['استثناء ناقل', 'danger'],
  CANCELLED: ['ملغاة', 'neutral'],
  RETURNED_TO_SENDER: ['أعيدت للمرسل', 'neutral'],
};

const RETURN: Record<string, Entry> = {
  REQUESTED: ['طلب جديد', 'warning'],
  APPROVED: ['موافق عليه', 'info'],
  REJECTED: ['مرفوض', 'danger'],
  IN_TRANSIT: ['في الطريق', 'progress'],
  RECEIVED: ['تم الاستلام', 'info'],
  REFUNDED: ['تم الاسترداد', 'success'],
  CLOSED: ['مغلق', 'neutral'],
};

const MERCHANT: Record<string, Entry> = {
  APPLIED: ['طلب انضمام', 'warning'],
  UNDER_REVIEW: ['قيد المراجعة', 'warning'],
  APPROVED: ['معتمد', 'success'],
  REJECTED: ['مرفوض', 'danger'],
  SUSPENDED: ['موقوف', 'danger'],
};

const PAYMENT: Record<string, Entry> = {
  INITIATED: ['بدأ الدفع', 'neutral'],
  CAPTURED: ['محصّل', 'success'],
  FAILED: ['فشل', 'danger'],
  CANCELLED: ['ملغي', 'neutral'],
  PARTIALLY_REFUNDED: ['مسترد جزئياً', 'info'],
  REFUNDED: ['مسترد', 'info'],
};

const REFUND: Record<string, Entry> = {
  PENDING: ['قيد التنفيذ', 'warning'],
  SUCCEEDED: ['تم', 'success'],
  FAILED: ['فشل', 'danger'],
};

const SETTLEMENT: Record<string, Entry> = {
  DRAFT: ['مسودة', 'warning'],
  APPROVED: ['معتمدة', 'info'],
  PAID: ['مدفوعة', 'success'],
};

const VERIFICATION: Record<string, Entry> = {
  PENDING: ['بانتظار المراجعة', 'warning'],
  APPROVED: ['مقبولة', 'success'],
  REJECTED: ['مرفوضة', 'danger'],
};

export const STATUS_MAPS = {
  order: ORDER,
  merchantOrder: MERCHANT_ORDER,
  shipment: SHIPMENT,
  return: RETURN,
  merchant: MERCHANT,
  payment: PAYMENT,
  refund: REFUND,
  settlement: SETTLEMENT,
  verification: VERIFICATION,
} as const;
export type StatusKind = keyof typeof STATUS_MAPS;

export function statusLabel(kind: StatusKind, value: string): string {
  return STATUS_MAPS[kind][value]?.[0] ?? value;
}
export function statusTone(kind: StatusKind, value: string): Tone {
  return STATUS_MAPS[kind][value]?.[1] ?? 'neutral';
}

export function webhookOutcomeTone(outcome: string): Tone {
  if (outcome.startsWith('processed')) return 'success';
  if (outcome.startsWith('flagged') || outcome.startsWith('rejected')) return 'danger';
  if (outcome.startsWith('pending')) return 'warning';
  return 'neutral';
}

export const ROLE_LABEL: Record<string, string> = { OPS_ADMIN: 'مدير العمليات', OPS_AGENT: 'موظف عمليات', FINANCE: 'المالية' };

export const DIRECTION_LABEL: Record<string, string> = { OUTBOUND: 'صادرة', RETURN: 'مرتجع' };

export const SERVICE_LABEL: Record<string, string> = { standard: 'عادي', express: 'سريع', sameDay: 'نفس اليوم', freight: 'شحن ثقيل' };

export const SOURCE_LABEL: Record<string, string> = { CARRIER: 'الناقل', OPS: 'العمليات', MERCHANT: 'التاجر', SYSTEM: 'النظام' };

export const ACTOR_LABEL: Record<string, string> = {
  customer: 'عميل',
  merchant: 'تاجر',
  ops: 'العمليات',
  system: 'النظام',
  carrier: 'الناقل',
  payment_provider: 'مزود الدفع',
};

export const ACCOUNT_LABEL: Record<string, string> = {
  CUSTOMER_CLEARING: 'تسوية العملاء',
  MERCHANT_PAYABLE: 'مستحقات التجار',
  PLATFORM_COMMISSION: 'عمولة المنصة',
  SHIPPING_PAYABLE: 'مستحقات الشحن',
  PAYOUTS: 'المدفوعات للتجار',
  SUSPENSE: 'حساب معلّق',
};

export const POSTING_LABEL: Record<string, string> = {
  PAYMENT_CAPTURED: 'تحصيل الدفع',
  PAYMENT_CAPTURED_UNFULFILLABLE: 'تحصيل دفع متأخر (يُسترد)',
  REFUND_SUCCEEDED: 'استرداد ناجح',
  PAYOUT: 'تحويل للتاجر',
};

export const RETURN_REASON_LABEL: Record<string, string> = {
  wrongPart: 'قطعة غير مطابقة',
  damaged: 'تالفة',
  notAsDescribed: 'لا تطابق الوصف',
  changedMind: 'تغيير رأي',
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  CR: 'السجل التجاري',
  VAT: 'شهادة ضريبة القيمة المضافة',
  IBAN: 'شهادة الآيبان',
  NATIONAL_ADDRESS: 'العنوان الوطني',
  OTHER: 'مستند آخر',
};

export const MEMBER_ROLE_LABEL: Record<string, string> = { OWNER: 'المالك', MANAGER: 'مدير', STAFF: 'موظف' };

export const PAYMENT_METHOD_LABEL: Record<string, string> = { mada: 'مدى', card: 'بطاقة', applePay: 'Apple Pay', stcPay: 'STC Pay' };

const AUDIT: Record<string, string> = {
  'merchant.approved': 'اعتماد التاجر',
  'merchant.rejected': 'رفض التاجر',
  'merchant.suspended': 'إيقاف التاجر',
  'merchant.applied': 'طلب انضمام تاجر',
  'merchant.profile_updated': 'تحديث ملف التاجر',
  'merchant.verification_submitted': 'إرسال مستندات التحقق',
  'merchant_order.accepted': 'قبول الطلب الفرعي',
  'merchant_order.packing': 'بدء التغليف',
  'merchant_order.ready_for_pickup': 'جاهز للاستلام',
  'merchant_order.handed_over': 'تسليم للناقل',
  'merchant_order.delivered': 'تسليم الطلب الفرعي',
  'merchant_order.rejected': 'رفض الطلب الفرعي',
  'merchant_order.cancelled': 'إلغاء الطلب الفرعي',
  'shipment.label_created': 'إنشاء بوليصة',
  'shipment.pickup_scheduled': 'جدولة الاستلام',
  'payment.captured': 'تحصيل الدفع',
  'refund.requested': 'طلب استرداد',
  'return.requested': 'طلب إرجاع',
  'return.approved': 'الموافقة على الإرجاع',
  'return.rejected': 'رفض الإرجاع',
  'return.received': 'استلام المرتجع',
  'return.inspection_accepted': 'قبول فحص المرتجع',
  'return.inspection_rejected': 'رفض فحص المرتجع',
  'order.cancelled': 'إلغاء الطلب',
  'settlement.generated': 'إنشاء تسوية',
  'settlement.approved': 'اعتماد تسوية',
  'settlement.paid': 'تسجيل تحويل تسوية',
  'ops_staff.granted': 'منح صلاحيات عمليات',
  'staff.added': 'إضافة موظف تاجر',
  'staff.updated': 'تحديث موظف تاجر',
  'offer.created': 'إنشاء عرض',
  'offer.updated': 'تحديث عرض',
  'offers.imported': 'استيراد عروض',
  'inventory.adjusted': 'تعديل مخزون',
  'location.created': 'إضافة موقع استلام',
  'location.updated': 'تحديث موقع استلام',
  'product.created': 'إنشاء منتج',
};
export const auditLabel = (action: string) => AUDIT[action] ?? action;

export const ENTITY_LABEL: Record<string, string> = {
  order: 'طلب',
  merchant_order: 'طلب فرعي',
  shipment: 'شحنة',
  return_case: 'مرتجع',
  merchant: 'تاجر',
  settlement: 'تسوية',
  user: 'مستخدم',
  refund: 'استرداد',
  payment: 'دفعة',
  offer: 'عرض',
  product: 'منتج',
  location: 'موقع',
};

const EVENT: Record<string, string> = {
  'shipment.updated': 'تحديث شحنة',
  'merchant_order.updated': 'تحديث طلب فرعي',
  'merchant.updated': 'تحديث تاجر',
  'merchant.applied': 'طلب انضمام تاجر',
  'order.created': 'طلب جديد',
  'order.expired': 'انتهاء مهلة الدفع',
  'order.paid': 'تم الدفع',
  'payment.failed': 'فشل الدفع',
  'refund.requested': 'طلب استرداد',
  'refund.succeeded': 'نجح الاسترداد',
  'refund.failed': 'فشل الاسترداد',
  'return.updated': 'تحديث مرتجع',
  'offer.updated': 'تحديث عرض',
};
export const eventLabel = (type: string) => EVENT[type] ?? type;
