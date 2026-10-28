import type { Metadata } from 'next';

import { LeadsView } from './LeadsView';

export const metadata: Metadata = { title: 'ورش محتملة' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <LeadsView />;
}
