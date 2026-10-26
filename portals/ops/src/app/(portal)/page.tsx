import type { Metadata } from 'next';

import { OverviewView } from './OverviewView';

export const metadata: Metadata = { title: 'نظرة عامة' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return <OverviewView />;
}
