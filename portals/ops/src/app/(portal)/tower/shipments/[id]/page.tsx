import type { Metadata } from 'next';

import { ShipmentDetailView } from './ShipmentDetailView';

export const metadata: Metadata = { title: 'تفاصيل الشحنة' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <ShipmentDetailView />;
}
