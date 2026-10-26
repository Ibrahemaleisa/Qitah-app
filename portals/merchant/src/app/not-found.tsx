import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="mt-2 text-xl font-bold">الصفحة غير موجودة</h1>
      <Link href="/" className="btn btn-primary mt-5">
        العودة إلى الرئيسية
      </Link>
    </main>
  );
}
