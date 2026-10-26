import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { ReturnsView } from './ReturnsView';

export const metadata: Metadata = { title: 'المرتجعات' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ReturnsView />
    </Suspense>
  );
}
