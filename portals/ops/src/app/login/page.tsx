import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default function LoginPage() {
  return (
    <main className="login-screen">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
