'use client';

import { useApi } from '@/lib/hooks';
import type { Summary } from '@/lib/types';

import { SubNav } from './ui';

export function TowerNav() {
  const { data } = useApi<Summary>('v1/ops/summary', { live: (e) => e.entityType === 'shipment' || e.entityType === 'merchant_order' });
  return (
    <SubNav
      items={[
        { href: '/tower', label: 'لوحة الشحنات', count: data?.activeShipments },
        { href: '/tower/queue', label: 'طابور التجهيز', count: data ? data.awaitingAcceptance + data.readyForPickup : undefined },
        { href: '/exceptions', label: 'الاستثناءات', count: data ? data.exceptions + data.slaBreaches : undefined, tone: 'danger' },
      ]}
    />
  );
}
