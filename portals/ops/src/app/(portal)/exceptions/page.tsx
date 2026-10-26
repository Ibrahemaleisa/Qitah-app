import type { Metadata } from 'next';

import { ExceptionsView } from './ExceptionsView';

export const metadata: Metadata = { title: 'الاستثناءات' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <ExceptionsView />;
}
