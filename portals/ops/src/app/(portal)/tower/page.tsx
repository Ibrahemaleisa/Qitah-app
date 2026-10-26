import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Loading } from '@/components/ui';

import { BoardView } from './BoardView';

export const metadata: Metadata = { title: 'برج التحكم — الشحنات' };

// Session-gated client UI (see ../layout.tsx): opt out of instant-navigation validation.
export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <BoardView />
    </Suspense>
  );
}
