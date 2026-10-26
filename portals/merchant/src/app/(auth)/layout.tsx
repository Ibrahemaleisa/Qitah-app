export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/qitah-symbol.svg" alt="" width={36} height={18} className="h-[18px] w-9" />
          <span className="font-bold text-brand">قطعة</span>
          <span className="text-sm text-slate">| بوابة التجار</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
