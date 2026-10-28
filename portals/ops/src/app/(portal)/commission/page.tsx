import type { Metadata } from 'next';

import { CommissionRulesView } from './CommissionRulesView';

export const metadata: Metadata = { title: 'قواعد العمولة' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <CommissionRulesView />;
}
