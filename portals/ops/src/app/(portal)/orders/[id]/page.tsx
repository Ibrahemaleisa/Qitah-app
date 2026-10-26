import type { Metadata } from 'next';

import { OrderTraceView } from './OrderTraceView';

export const metadata: Metadata = { title: 'تتبع الطلب' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <OrderTraceView />;
}
