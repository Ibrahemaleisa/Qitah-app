/** Arabic labels for API enums. Unknown values fall back to the raw value. */

export const CITIES: { id: string; ar: string }[] = [
  { id: "riyadh", ar: "الرياض" },
  { id: "jeddah", ar: "جدة" },
  { id: "makkah", ar: "مكة المكرمة" },
  { id: "madinah", ar: "المدينة المنورة" },
  { id: "dammam", ar: "الدمام" },
  { id: "khobar", ar: "الخبر" },
];

export const cityAr = (id: string | null | undefined) => CITIES.find((c) => c.id === id)?.ar ?? id ?? "—";

export const ROLE_AR: Record<string, string> = { OWNER: "مالك", MANAGER: "مدير", STAFF: "موظف" };

export const MERCHANT_STATUS_AR: Record<string, string> = {
  APPLIED: "تم استلام الطلب",
  UNDER_REVIEW: "قيد المراجعة",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
  SUSPENDED: "موقوف",
};

export const ORDER_STATUS_AR: Record<string, string> = {
  PENDING_PAYMENT: "بانتظار الدفع",
  NEW: "جديد",
  ACCEPTED: "مقبول",
  PACKING: "قيد التجهيز",
  READY_FOR_PICKUP: "جاهز للاستلام",
  HANDED_OVER: "مع شركة الشحن",
  DELIVERED: "تم التوصيل",
  REJECTED: "مرفوض",
  CANCELLED: "ملغي",
};

export const REJECT_REASONS: { id: string; ar: string }[] = [
  { id: "OUT_OF_STOCK", ar: "نفد المخزون" },
  { id: "PRICE_ERROR", ar: "خطأ في السعر" },
  { id: "DAMAGED", ar: "القطعة تالفة" },
  { id: "CANNOT_FULFIL_IN_TIME", ar: "لا يمكن التجهيز في الوقت المحدد" },
  { id: "OTHER", ar: "سبب آخر" },
];

export const SHIPMENT_STATUS_AR: Record<string, string> = {
  PENDING: "بانتظار البوليصة",
  LABEL_CREATED: "تم إصدار البوليصة",
  PICKUP_SCHEDULED: "تمت جدولة الاستلام",
  PICKED_UP: "تم الاستلام من المتجر",
  IN_TRANSIT: "في الطريق",
  OUT_FOR_DELIVERY: "خرج للتوصيل",
  DELIVERED: "تم التوصيل",
  PICKUP_FAILED: "تعذر الاستلام",
  DELIVERY_FAILED: "تعذر التوصيل",
  EXCEPTION: "استثناء",
  CANCELLED: "ملغاة",
  RETURNED_TO_SENDER: "أعيدت للمرسل",
};

export const CONDITION_AR: Record<string, string> = { NEW: "جديد", USED: "مستعمل", REFURBISHED: "مجدد" };
export const OFFER_STATUS_AR: Record<string, string> = { ACTIVE: "نشط", PAUSED: "موقوف مؤقتاً", ARCHIVED: "مؤرشف" };
export const ORIGIN_AR: Record<string, string> = { OEM: "أصلي (OEM)", AFTERMARKET: "تجاري (Aftermarket)" };
export const HANDLING_AR: Record<string, string> = { STANDARD: "عادي", FRAGILE: "قابل للكسر", OVERSIZED: "كبير الحجم", HAZMAT: "مواد خطرة" };

export const ADJUSTMENT_REASON_AR: Record<string, string> = {
  INITIAL: "رصيد افتتاحي",
  RESTOCK: "إعادة تخزين",
  CORRECTION: "تصحيح جرد",
  DAMAGE: "تلف",
  SALE: "بيع",
  CANCELLATION_RESTOCK: "إرجاع بعد إلغاء",
  RETURN_RESTOCK: "إرجاع من عميل",
  IMPORT: "استيراد",
};

export const RETURN_STATUS_AR: Record<string, string> = {
  REQUESTED: "طلب جديد",
  APPROVED: "تمت الموافقة",
  REJECTED: "مرفوض",
  IN_TRANSIT: "في الطريق إليك",
  RECEIVED: "تم الاستلام",
  REFUNDED: "تم الاسترداد",
  CLOSED: "مغلق",
};

export const FIT_STATUS_AR: Record<string, string> = {
  catalogMatch: "مطابقة من الكتالوج",
  bySpecification: "حسب المواصفة",
  sellerReported: "توافق أبلغ عنه البائع",
  noData: "توافق غير معروف",
};

export const RETURN_PAYER_AR: Record<string, string> = {
  PLATFORM: "قطعة (ضمان قطعة)",
  MERCHANT: "أنت (البائع)",
  CUSTOMER: "العميل (يُخصم من استرداده)",
};

export const RETURN_REASON_AR: Record<string, string> = {
  wrongPart: "قطعة غير مطابقة",
  damaged: "وصلت تالفة",
  notAsDescribed: "مختلفة عن الوصف",
  changedMind: "غيّر العميل رأيه",
};

export const SETTLEMENT_STATUS_AR: Record<string, string> = { DRAFT: "مسودة", APPROVED: "معتمدة", PAID: "مدفوعة" };
export const VERIFICATION_STATUS_AR: Record<string, string> = { PENDING: "قيد المراجعة", APPROVED: "مقبول", REJECTED: "مرفوض" };
export const DOCUMENT_TYPE_AR: Record<string, string> = {
  CR: "السجل التجاري",
  VAT: "شهادة ضريبة القيمة المضافة",
  IBAN: "شهادة الآيبان",
  NATIONAL_ADDRESS: "العنوان الوطني",
  OTHER: "مستند آخر",
};

export const ACTION_AR: Record<string, string> = {
  "merchant.applied": "تقديم طلب الانضمام",
  "merchant.profile_updated": "تعديل بيانات المتجر",
  "merchant.verification_submitted": "إرسال مستندات التحقق",
  "merchant.approved": "اعتماد المتجر",
  "merchant.rejected": "رفض طلب المتجر",
  "merchant.suspended": "إيقاف المتجر",
  "location.created": "إضافة فرع",
  "location.updated": "تعديل فرع",
  "staff.added": "إضافة عضو فريق",
  "staff.updated": "تعديل عضو فريق",
  "product.created": "إضافة منتج",
  "offer.created": "إضافة عرض",
  "offer.updated": "تعديل عرض",
  "inventory.adjusted": "تعديل المخزون",
  "offers.imported": "استيراد عروض",
  "merchant_order.accepted": "قبول طلب",
  "merchant_order.packing": "بدء تجهيز طلب",
  "merchant_order.ready_for_pickup": "طلب جاهز للاستلام",
  "merchant_order.rejected": "رفض طلب",
  "merchant_order.cancelled": "إلغاء طلب",
  "return.approved": "الموافقة على مرتجع",
  "return.rejected": "رفض مرتجع",
  "return.received": "استلام مرتجع",
  "return.inspection_accepted": "قبول فحص مرتجع",
  "return.inspection_rejected": "رفض فحص مرتجع",
  "part_quote.submitted": "تقديم عرض على طلب قطعة",
  "part_quote.updated": "تعديل عرض على طلب قطعة",
  "part_quote.withdrawn": "سحب عرض على طلب قطعة",
  "part_quote.accepted": "قبول العميل عرضاً على طلب قطعة",
};

export const ACTOR_AR: Record<string, string> = { merchant: "فريق المتجر", ops: "فريق قطعة", customer: "العميل", system: "النظام" };

export const label = (map: Record<string, string>, value: string | null | undefined) => (value ? (map[value] ?? value) : "—");

export const FRESHNESS_AR: Record<string, string> = {
  fresh: "محدَّث",
  stale: "بحاجة لتأكيد",
  hidden: "مخفي عن العملاء",
};

export const SCORECARD_WARNING_AR: Record<string, string> = {
  OUT_OF_STOCK_HIGH: "رفض بسبب نفاد المخزون أعلى من 3%",
  FRESHNESS_LOW: "أقل من 90% من عروضك مؤكدة حديثاً",
  ACCEPTANCE_LOW: "نسبة القبول أقل من 90%",
  ON_TIME_LOW: "التجهيز في الموعد أقل من 90%",
  BAD_RETURNS_HIGH: "مرتجعات (قطعة خطأ / غير مطابقة) أعلى من 5%",
};

export const COMMISSION_SOURCE_AR: Record<string, string> = {
  rule: "حسب الفئة",
  merchant: "نسبة متفق عليها",
  default: "النسبة الافتراضية",
};
