import type { OrderStatus } from '@/services/orders';
import type { BadgeTone } from '@/ui/Badge';
import type { IconName } from '@/ui/Icon';

export const orderStatusVisuals: Record<OrderStatus, { tone: BadgeTone; icon: IconName }> = {
  processing: { tone: 'warning', icon: 'clock' },
  inTransit: { tone: 'info', icon: 'truck' },
  partiallyDelivered: { tone: 'accent', icon: 'package' },
  delivered: { tone: 'success', icon: 'check-circle' },
  cancelled: { tone: 'danger', icon: 'x-circle' },
};
