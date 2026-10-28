import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { workshopApi, type ApiOrgMember } from '@/api/workshop';
import { normalizeSaudiMobile } from '@/domain/workshop';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import { WorkshopGate, workshopErrorMessage } from '@/features/workshop/WorkshopUi';
import { useI18n } from '@/i18n';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';
import { inviteMember, removeMember, useActiveOrg } from '@/services/remote/workshop';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { EmptyState } from '@/ui/EmptyState';
import { Input } from '@/ui/Input';
import { Screen, ScreenHeader } from '@/ui/Screen';
import { Section } from '@/ui/Section';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

/** The workshop team. The OWNER invites buyers/technicians by phone; they join when they sign in with OTP. */
export default function WorkshopMembers() {
  const { s } = useI18n();
  return (
    <WorkshopGate title={s.workshop.members}>
      <Members />
    </WorkshopGate>
  );
}

function Members() {
  const { s } = useI18n();
  const active = useActiveOrg();
  const orgId = active?.org.id;
  const isOwner = active?.role === 'OWNER';
  const [members, setMembers] = useState<ApiOrgMember[]>([]);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'BUYER' | 'TECHNICIAN'>('BUYER');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (orgId) setMembers((await workshopApi.members(orgId)).members);
  }, [orgId]);
  usePollWhileFocused(load, 30_000, !!orgId);

  if (!active || !orgId) {
    return (
      <Screen header={<ScreenHeader back title={s.workshop.members} />}>
        <EmptyState icon="store" title={s.workshop.mode} body={s.workshop.retailHint} />
      </Screen>
    );
  }

  const mobile = normalizeSaudiMobile(phone);
  const invite = async () => {
    if (!mobile) return;
    setBusy(true);
    try {
      setMembers(await inviteMember(orgId, mobile, role));
      setPhone('');
      haptic.success();
      toast(s.workshop.inviteSent, 'check');
    } catch (e) {
      toast(workshopErrorMessage(s, e), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };
  const remove = (m: ApiOrgMember) =>
    confirmAction(s.workshop.removeConfirm, s.workshop.remove, s.common.cancel, () => {
      removeMember(orgId, m.id)
        .then(setMembers)
        .catch((e) => toast(workshopErrorMessage(s, e), 'alert-circle'));
    });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<ScreenHeader back title={s.workshop.members} subtitle={active.org.displayName} />}>
        <View style={{ marginTop: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
          {members.map((m, i) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{m.name ?? s.workshop.invited}</Text>
                {m.phone ? (
                  <Text variant="caption" color="textSecondary" ltr>
                    {m.phone}
                  </Text>
                ) : null}
              </View>
              <Badge label={s.workshop.role[m.role]} tone={m.role === 'OWNER' ? 'inverse' : 'neutral'} />
              {m.status === 'INVITED' ? <Badge label={s.workshop.invited} tone="info" /> : null}
              {isOwner && m.role !== 'OWNER' ? <Button label={s.workshop.remove} size="sm" variant="secondary" onPress={() => remove(m)} /> : null}
            </View>
          ))}
        </View>

        {isOwner ? (
          <Section title={s.workshop.invite}>
            <View style={{ gap: space.md }}>
              <Input label={s.workshop.invitePhone} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} ltr placeholder="05XXXXXXXX" error={phone && !mobile ? s.workshop.invalidPhone : undefined} />
              <Text variant="captionStrong" color="textSecondary">
                {s.workshop.inviteRole}
              </Text>
              {(['BUYER', 'TECHNICIAN'] as const).map((r) => (
                <ChoiceRow key={r} selected={role === r} onPress={() => setRole(r)} title={s.workshop.role[r]} subtitle={s.workshop.roleHint[r]} />
              ))}
              <Button label={s.workshop.invite} icon="plus" onPress={invite} loading={busy} disabled={!mobile || busy} />
            </View>
          </Section>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
