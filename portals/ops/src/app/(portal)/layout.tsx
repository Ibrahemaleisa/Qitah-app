import { AppShell } from '@/components/AppShell';
import { LiveEventsProvider } from '@/components/LiveEvents';
import { SessionGate } from '@/components/Session';
import { ToastProvider } from '@/components/Toasts';

/**
 * Every portal page is session-gated on the client (SessionGate renders nothing until /v1/me resolves),
 * so there is no meaningful static shell to validate for instant navigation; each page opts out.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SessionGate>
        <LiveEventsProvider>
          <AppShell>{children}</AppShell>
        </LiveEventsProvider>
      </SessionGate>
    </ToastProvider>
  );
}
