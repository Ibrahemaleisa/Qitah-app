import type { Metadata } from 'next';

import { MerchantDetailView } from './MerchantDetailView';

export const metadata: Metadata = { title: 'ملف التاجر' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <MerchantDetailView />;
}
