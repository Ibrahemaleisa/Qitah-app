import type { Metadata } from 'next';

import { OrganizationDetailView } from './OrganizationDetailView';

export const metadata: Metadata = { title: 'ملف الورشة' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <OrganizationDetailView />;
}
