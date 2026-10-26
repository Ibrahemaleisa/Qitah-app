import type { Metadata } from 'next';

import { FinanceView } from './FinanceView';

export const metadata: Metadata = { title: 'المالية' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <FinanceView />;
}
