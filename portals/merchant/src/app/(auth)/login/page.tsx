import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default function LoginPage() {
  return (
    <div className="mx-auto grid max-w-4xl items-start gap-8 md:grid-cols-2">
      <section className="hidden rounded-2xl bg-brand p-8 text-white md:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/qitah-symbol-white.svg" alt="" width={72} height={36} className="mb-6 h-9 w-[72px]" />
        <h2 className="text-2xl font-bold">أهلاً بك في بوابة تجار قطعة</h2>
        <ul className="mt-5 space-y-3 text-[15px] text-white/85">
          <li>• استقبل الطلبات وجهّزها في الوقت المحدد</li>
          <li>• حدّث المخزون والأسعار من مكان واحد</li>
          <li>• تابع الشحنات والمرتجعات والمستحقات</li>
        </ul>
      </section>
      <section className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-brand">تسجيل الدخول</h1>
        <p className="mt-1 text-sm text-slate">ادخل بالبريد الإلكتروني وكلمة المرور الخاصة بحسابك في المتجر.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  );
}
