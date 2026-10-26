import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { AuditView } from './AuditView';

export const metadata: Metadata = { title: 'سجل التدقيق' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <AuditView />
    </Suspense>
  );
}
