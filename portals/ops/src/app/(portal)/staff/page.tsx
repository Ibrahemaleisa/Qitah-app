import type { Metadata } from 'next';

import { StaffView } from './StaffView';

export const metadata: Metadata = { title: 'فريق العمليات' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <StaffView />;
}
