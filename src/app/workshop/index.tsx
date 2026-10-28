import { router } from 'expo-router';
import { View } from 'react-native';

import { canBuyForOrg, canSeeMoney } from '@/domain/workshop';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { CreditSummary, WorkshopGate } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { refreshOrgs, setActiveOrg, useActiveOrg, useWorkshop } from '@/services/remote/workshop';
import { space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { ListGroup, ListRow } from '@/ui/ListRow';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';

/**
 * "وضع الورشة": choose who you are buying as (personal = retail, unchanged; or a workshop you belong to),
 * then the workshop's credit, statement, customer quotes and team.
 */
export default function WorkshopHome() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.mode}>
      <WorkshopHub />
    </WorkshopGate>
  );
}

function WorkshopHub() {
  const { s } = useI18n();
  const orgs = useWorkshop((st) => st.orgs);
  const activeId = useWorkshop((st) => st.activeOrgId);
  const active = useActiveOrg();
  usePollWhileFocused(refreshOrgs, 30_000, true);

  const pick = (orgId: string | null) => {
    haptic.tap();
    setActiveOrg(orgId);
  };

  return (
    <Screen header={<ScreenHeader back title={s.workshop.mode} subtitle={active ? s.workshop.buyingFor(active.org.displayName) : s.workshop.retail} />}>
      <Section title={s.workshop.switchTitle}>
        <View style={{ gap: space.sm }}>
          <ChoiceRow selected={!activeId} onPress={() => pick(null)} title={s.workshop.retail} subtitle={s.workshop.retailHint} />
          {orgs.map((m) => (
            <ChoiceRow
              key={m.org.id}
              selected={activeId === m.org.id}
              disabled={m.org.status !== 'APPROVED'}
              onPress={() => pick(m.org.id)}
              title={m.org.displayName}
              subtitle={`${s.workshop.role[m.role]} · ${s.workshop.status[m.org.status]}`}
              trailing={m.org.status === 'APPROVED' ? undefined : <Badge label={s.workshop.status[m.org.status]} tone={m.org.status === 'APPLIED' ? 'info' : 'danger'} />}
            />
          ))}
        </View>
        {orgs.some((m) => m.org.status === 'APPLIED') ? (
          <View style={{ marginTop: space.md }}>
            <Notice tone="info" icon="clock" text={s.workshop.pendingReview} />
          </View>
        ) : null}
        {orgs
          .filter((m) => m.org.status === 'REJECTED' || m.org.status === 'SUSPENDED')
          .map((m) => (
            <View key={m.org.id} style={{ marginTop: space.md }}>
              <Notice tone="warning" text={m.org.status === 'REJECTED' ? s.workshop.rejected(m.org.statusReason ?? '') : s.workshop.suspended} />
            </View>
          ))}
      </Section>

      {active ? (
        <>
          {canSeeMoney(active) ? (
            <Section title={s.workshop.credit}>
              <CreditSummary credit={active.credit} />
            </Section>
          ) : null}
          <View style={{ marginTop: space.lg }}>
            <ListGroup>
              <ListRow icon="package" title={s.workshop.orders} onPress={() => router.navigate('/orders')} />
              {canSeeMoney(active) ? <ListRow icon="receipt" title={s.workshop.statement} onPress={() => router.push('/workshop/statement')} /> : null}
              {canBuyForOrg(active) ? <ListRow icon="share" title={s.workshop.quotes} onPress={() => router.push('/workshop/quotes')} /> : null}
              <ListRow icon="user" title={s.workshop.members} onPress={() => router.push('/workshop/members')} last />
            </ListGroup>
          </View>
        </>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <ListGroup>
          <ListRow icon="store" title={s.workshop.apply} subtitle={s.workshop.applyHint} onPress={() => router.push('/workshop/apply')} last />
        </ListGroup>
      </View>
    </Screen>
  );
}
