import type { FitStatus } from '@/domain/compatibility';
import type { Condition, PartOrigin } from '@/domain/types';
import { useI18n } from '@/i18n';
import { Badge, type BadgeTone } from '@/ui/Badge';
import type { IconName } from '@/ui/Icon';

export function OriginBadge({ origin, short }: { origin: PartOrigin; short?: boolean }) {
  const { s } = useI18n();
  return <Badge label={(short ? s.originShort : s.origin)[origin]} tone={origin === 'oem' ? 'oem' : 'aftermarket'} icon={origin === 'oem' ? 'shield' : undefined} />;
}

export function ConditionBadge({ condition }: { condition: Condition }) {
  const { s } = useI18n();
  const tone: BadgeTone = condition === 'new' ? 'success' : condition === 'used' ? 'used' : 'refurbished';
  return <Badge label={s.condition[condition]} tone={tone} />;
}

export const fitVisuals: Record<FitStatus, { tone: BadgeTone; icon: IconName }> = {
  catalogMatch: { tone: 'success', icon: 'check-circle' },
  sellerReported: { tone: 'warning', icon: 'alert-circle' },
  bySpecification: { tone: 'info', icon: 'sliders' },
  noData: { tone: 'neutral', icon: 'help-circle' },
  noVehicle: { tone: 'neutral', icon: 'plus-circle' },
};

export function FitBadge({ status }: { status: FitStatus }) {
  const { s } = useI18n();
  const v = fitVisuals[status];
  return <Badge label={s.fit[status]} tone={v.tone} icon={v.icon} />;
}

export function SampleBadge() {
  const { s } = useI18n();
  return <Badge label={s.common.sampleBadge} tone="accent" icon="flag" />;
}
