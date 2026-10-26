import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { MerchantsView } from './MerchantsView';

export const metadata: Metadata = { title: 'التجار' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MerchantsView />
    </Suspense>
  );
}
