import { router } from 'expo-router';

import { useI18n } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Screen, ScreenHeader } from '@/ui/Screen';

export default function NotFound() {
  const { s } = useI18n();
  return (
    <Screen header={<ScreenHeader back />}>
      <EmptyState icon="compass" title={s.errors.notFound} body={s.errors.notFoundHint} action={{ label: s.errors.goHome, onPress: () => router.replace('/') }} />
    </Screen>
  );
}
