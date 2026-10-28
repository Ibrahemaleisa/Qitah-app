import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { PartRequestsView } from './PartRequestsView';

export const metadata: Metadata = { title: 'طلبات القطع' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PartRequestsView />
    </Suspense>
  );
}
