import type { Metadata } from 'next';

import { ReceivablesView } from './ReceivablesView';

export const metadata: Metadata = { title: 'مستحقات الورش المتأخرة' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <ReceivablesView />;
}
