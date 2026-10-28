"use client";

/**
 * Browser-side API client. Every call goes to this app's BFF proxy (/api/proxy/…), which attaches
 * the session token server-side. The browser never sees a token.
 */

const ERROR_AR: Record<string, string> = {
  INSUFFICIENT_STOCK: "الكمية المتاحة في المخزون لا تكفي.",
  INVALID_TRANSITION: "لا يمكن تنفيذ هذا الإجراء في الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.",
  FORBIDDEN: "ليست لديك صلاحية لتنفيذ هذا الإجراء.",
  VALIDATION_FAILED: "بعض البيانات غير صحيحة. راجع الحقول المحددة.",
  BELOW_RESERVED: "لا يمكن أن يقل المخزون عن الكمية المحجوزة لطلبات قائمة.",
  LAST_OWNER: "يجب أن يبقى للمتجر مالك نشط واحد على الأقل.",
  PRODUCT_EXISTS: "هذه العلامة التجارية ورقم القطعة موجودان في الكتالوج. أضف عرضك على المنتج الموجود.",
  EMAIL_IN_USE: "يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول ثم قدّم الطلب.",
  ALREADY_EXISTS: "يوجد سجل بنفس البيانات (مثل رمز SKU أو السجل التجاري أو البريد).",
  UNAUTHENTICATED: "انتهت الجلسة أو بيانات الدخول غير صحيحة.",
  NOT_FOUND: "العنصر غير موجود أو لا تملك صلاحية الوصول إليه.",
  RATE_LIMITED: "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
  PASSWORD_REQUIRED: "يجب تعيين كلمة مرور.",
  INVALID_LOCATION: "اختر فرعاً نشطاً من فروعك.",
  INVALID_PRODUCT: "المنتج غير متاح.",
  INVALID_CATEGORY: "الفئة غير معروفة.",
  INVALID_FITMENT: "بيانات التوافق غير صحيحة (تحقق من سنوات الموديل).",
  INVALID_DISPATCH: "أقصى مدة للتجهيز يجب أن تكون أكبر من أو تساوي الحد الأدنى.",
  INVALID_AMOUNT: "مبلغ الاسترداد غير صحيح.",
  NOT_REFUNDABLE: "لا توجد عملية دفع قابلة للاسترداد لهذا الطلب.",
  NOT_READY: "الطلب غير جاهز بعد.",
  ALREADY_SHIPPED: "تم استلام الشحنة من قبل شركة الشحن.",
  MISSING_COLUMN: "ملف CSV ينقصه عمود مطلوب.",
  EMPTY_IMPORT: "ملف CSV يحتاج صف عناوين وصف بيانات واحد على الأقل.",
  TOO_MANY_ROWS: "الحد الأقصى 1000 صف في كل استيراد.",
  REASON_REQUIRED: "يجب ذكر السبب.",
  UNSUPPORTED_TYPE: "ارفع ملف PDF أو JPEG أو PNG.",
  UPLOAD_FAILED: "تعذر رفع الملف. حاول مرة أخرى.",
  TOO_LARGE:"حجم الملف أو الطلب كبير جداً.",
  CSRF_REJECTED: "تم رفض الطلب لأسباب أمنية. حدّث الصفحة وحاول مرة أخرى.",
  API_UNAVAILABLE: "تعذر الاتصال بخادم قطعة. حاول بعد قليل.",
  NETWORK: "تعذر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.",
  INTERNAL: "حدث خطأ غير متوقع. حاول مرة أخرى.",
  QUOTE_EXISTS: "قدّمت عرضاً على هذا الطلب من قبل. عدّل عرضك بدلاً من إنشاء عرض جديد.",
  REQUEST_CLOSED: "هذا الطلب لم يعد يستقبل عروضاً.",
  QUOTE_LOCKED: "لا يمكن تعديل هذا العرض بعد قبوله أو سحبه أو انتهاء صلاحيته.",
  PART_REQUIRED: "اختر القطعة من الكتالوج أو اكتب اسمها.",
  INVALID_PRICE: "السعر غير صحيح.",
  INVALID_QUANTITY: "الكمية أكبر مما طلبه العميل.",
  INVALID_PHOTO: "الصورة غير صالحة. ارفعها من جديد.",
  CHALLENGE_REQUIRED: "يتطلب حسابك خطوة تحقق إضافية غير مدعومة في البوابة بعد.",
};

export type FieldIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** The API's English message. */
    public serverMessage: string,
    public details?: unknown,
  ) {
    super(serverMessage);
  }

  /** Arabic, user-facing. */
  get messageAr(): string {
    if (this.status === 403 && this.code === "FORBIDDEN") return ERROR_AR.FORBIDDEN;
    return ERROR_AR[this.code] ?? (this.status >= 500 ? ERROR_AR.INTERNAL : "تعذر تنفيذ الطلب.");
  }

  get fieldIssues(): FieldIssue[] {
    return Array.isArray(this.details) ? (this.details as FieldIssue[]).filter((d) => d && typeof d.path === "string") : [];
  }
}

let redirecting = false;

function goToLogin() {
  if (redirecting || typeof window === "undefined") return;
  redirecting = true;
  const next = window.location.pathname + window.location.search;
  // Full page load: the session is gone, so nothing in memory should survive.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(next)}&expired=1`);
}

type Init = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal; query?: Record<string, string | number | undefined | null> };

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const clean = path.replace(/^\/+/, "");
  const qs = init.query
    ? new URLSearchParams(Object.entries(init.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString()
    : "";
  const method = init.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${clean}${qs ? `${clean.includes("?") ? "&" : "?"}${qs}` : ""}`, {
      method,
      headers: { accept: "application/json", ...(method !== "GET" ? { "content-type": "application/json" } : {}) },
      body: method !== "GET" ? JSON.stringify(init.body ?? {}) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "Network error");
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = ((json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error ?? {}) as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    if (res.status === 401) goToLogin();
    throw new ApiError(res.status, err.code ?? `HTTP_${res.status}`, err.message ?? res.statusText, err.details);
  }
  return json as T;
}

/** Auth endpoints live outside the proxy. */
export async function authPost<T>(path: "/api/auth/login" | "/api/auth/register" | "/api/auth/logout", body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK", "Network error");
  }
  const json = (await res.json().catch(() => undefined)) as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? res.statusText, json?.error?.details);
  return json as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.messageAr;
  return "حدث خطأ غير متوقع.";
}
