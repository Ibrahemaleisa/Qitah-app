/** Readable Arabic messages for API error codes. Unknown codes fall back to the API's message. */
const MESSAGES: Record<string, string> = {
  INVALID_TRANSITION: 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية — ربما تغيّرت الحالة للتو. حدّث الصفحة وحاول مجدداً.',
  NOT_READY: 'لم يُعلّم التاجر الطلب كجاهز بعد، لا يمكن إنشاء البوليصة.',
  NO_LABEL: 'أنشئ بوليصة الشحن أولاً.',
  REFUND_EXCEEDS_CAPTURED: 'مبلغ الاسترداد يتجاوز المبلغ المحصّل.',
  REFUND_EXCEEDS_ITEMS: 'مبلغ الاسترداد يتجاوز قيمة أصناف هذا الطلب الفرعي غير المستردة.',
  NOTHING_TO_SETTLE: 'لا توجد طلبات مؤهلة للتسوية لهذا التاجر حالياً.',
  FORBIDDEN: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
  VALIDATION_FAILED: 'البيانات المدخلة غير صحيحة.',
  UNAUTHENTICATED: 'انتهت الجلسة. سجّل الدخول مجدداً.',
  NOT_FOUND: 'العنصر غير موجود.',
  REASON_REQUIRED: 'يجب كتابة السبب.',
  INVALID_WINDOW: 'نهاية نافذة الاستلام يجب أن تكون بعد بدايتها.',
  NOT_REFUNDABLE: 'لا توجد دفعة محصّلة قابلة للاسترداد.',
  INVALID_AMOUNT: 'المبلغ غير صالح.',
  ALREADY_SHIPPED: 'استلم الناقل الشحنة بالفعل، لا يمكن الرفض.',
  DUPLICATE_EVENT: 'هذا الحدث مسجّل مسبقاً.',
  PASSWORD_REQUIRED: 'كلمة مرور أولية مطلوبة في وضع الدخول المحلي.',
  ALREADY_EXISTS: 'يوجد سجل بنفس البيانات.',
  RATE_LIMITED: 'طلبات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
  CSRF_REJECTED: 'رُفض الطلب لأنه لم يصدر من البوابة.',
  UPSTREAM_UNAVAILABLE: 'تعذر الوصول إلى خادم قطعة.',
  NETWORK: 'تعذر الاتصال. تحقق من الشبكة.',
  INTERNAL: 'حدث خطأ غير متوقع في الخادم.',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const base = MESSAGES[e.code] ?? e.message;
    if (e.code === 'VALIDATION_FAILED' && Array.isArray(e.details) && e.details.length) {
      const fields = (e.details as { path?: string }[]).map((d) => d.path).filter(Boolean);
      return fields.length ? `${base} (${fields.join('، ')})` : base;
    }
    return base;
  }
  return e instanceof Error ? e.message : String(e);
}
