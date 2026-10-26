import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { OrdersView } from './OrdersView';

export const metadata: Metadata = { title: 'الطلبات' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <OrdersView />
    </Suspense>
  );
}
