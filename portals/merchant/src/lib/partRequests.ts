/** Part requests ("طلبات القطع" / RFQ): wire types and Arabic labels. */

export type PartRequestStatus = "OPEN" | "QUOTED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
export type PartQuoteStatus = "ACTIVE" | "WITHDRAWN" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export type PartRequestCore = {
  id: string;
  number: string;
  status: PartRequestStatus;
  vehicle: { makeId: string; modelId: string; year: number; engine: string | null; vin: string | null; label: { ar: string; en: string } };
  description: string;
  partNumber: string | null;
  quantity: number;
  preferredCondition: "any" | "new" | "used";
  preferredOrigin: "any" | "oem" | "aftermarket";
  city: string;
  photoCount: number;
  createdAt: string;
  expiresAt: string;
  firstQuotedAt: string | null;
  acceptedAt: string | null;
};

export type MyQuote = {
  id: string;
  status: PartQuoteStatus;
  productId: string | null;
  partName: string | null;
  brand: string | null;
  partNumber: string | null;
  categoryId: string | null;
  origin: "OEM" | "AFTERMARKET" | null;
  condition: "NEW" | "USED" | "REFURBISHED";
  priceHalalas: number;
  quantity: number;
  warrantyMonths: number;
  dispatchDays: [number, number];
  note: string | null;
  validUntil: string;
  locationId: string;
  photoKey: string | null;
  offerId: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InboxResponse = { rule: string; scope: { cities: string[]; makeIds: string[] }; items: (PartRequestCore & { myQuote: MyQuote | null })[] };

export type RequestDetail = PartRequestCore & {
  photos: { url: string }[];
  myQuote: (MyQuote & { photoUrl: string | null; product: { id: string; nameAr: string; nameEn: string; brand: string; partNumber: string; status: string } | null }) | null;
};

export type MyQuotesResponse = {
  items: (MyQuote & { won: boolean; request: PartRequestCore; merchantOrders: { id: string; number: string; status: string }[] })[];
};

export const REQUEST_STATUS_AR: Record<PartRequestStatus, string> = {
  OPEN: "بانتظار العروض",
  QUOTED: "وصلته عروض",
  ACCEPTED: "تم اختيار عرض",
  EXPIRED: "منتهي",
  CANCELLED: "ملغى",
};

export const QUOTE_STATUS_AR: Record<PartQuoteStatus, string> = {
  ACTIVE: "عرضك قائم",
  WITHDRAWN: "سحبت العرض",
  ACCEPTED: "فاز عرضك",
  DECLINED: "لم يُختر",
  EXPIRED: "انتهت صلاحيته",
};

export const PREFERRED_CONDITION_AR: Record<string, string> = { any: "أي حالة", new: "جديدة فقط", used: "مستعملة مقبولة" };
export const PREFERRED_ORIGIN_AR: Record<string, string> = { any: "أصلي أو تجاري", oem: "أصلي (OEM)", aftermarket: "تجاري (Aftermarket)" };

export const QUOTE_TONE: Record<PartQuoteStatus, "success" | "brand" | "neutral" | "warning" | "danger"> = {
  ACTIVE: "brand",
  ACCEPTED: "success",
  WITHDRAWN: "neutral",
  DECLINED: "neutral",
  EXPIRED: "warning",
};

export const VALIDITY_HOURS = [6, 12, 24, 48, 72] as const;

/** "منذ 7 د" / "منذ 3 س" — age of a request, for the 15-minute response target. */
export function ageAr(iso: string, now: number): { text: string; minutes: number } {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  const text = minutes < 60 ? `منذ ${minutes} د` : minutes < 1440 ? `منذ ${Math.floor(minutes / 60)} س` : `منذ ${Math.floor(minutes / 1440)} ي`;
  return { text, minutes };
}
