import type { Metadata } from 'next';

import { PerformanceView } from './PerformanceView';

export const metadata: Metadata = { title: 'أداء التجار' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <PerformanceView />;
}
