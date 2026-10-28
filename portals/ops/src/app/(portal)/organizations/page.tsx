import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { OrganizationsView } from './OrganizationsView';

export const metadata: Metadata = { title: 'الورش' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <OrganizationsView />
    </Suspense>
  );
}
