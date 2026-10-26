import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

/**
 * Opens the payment provider's hosted page (sandbox today). The app never decides the outcome:
 * after the page closes we only re-read the order from the server.
 *
 * - iOS/Android: `openAuthSessionAsync(url, 'qitah://checkout/return')` — resolves when the provider
 *   redirects back to the app or the customer closes the sheet.
 * - Web: a new tab. Browsers block `window.open` that happens long after a tap, so callers open a
 *   blank tab synchronously in the tap handler (`preopenPaymentTab`) and point it at the URL once the
 *   API answers. The order screen then polls for the result.
 */

export const PAYMENT_RETURN_URL = 'qitah://checkout/return';

type WebWindow = { location: { href: string }; close: () => void; closed: boolean };

export function preopenPaymentTab(): WebWindow | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.open('', '_blank') as WebWindow | null;
  } catch {
    return null;
  }
}

export function closePaymentTab(tab: WebWindow | null) {
  try {
    if (tab && !tab.closed) tab.close();
  } catch {
    // ignore
  }
}

/** Returns `false` only when a web popup was blocked (the UI then shows an "open payment page" button). */
export async function openPaymentPage(url: string, preopened?: WebWindow | null): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (preopened && !preopened.closed) {
      preopened.location.href = url;
      return true;
    }
    if (typeof window === 'undefined') return false;
    const tab = window.open(url, '_blank');
    return !!tab;
  }
  try {
    await WebBrowser.openAuthSessionAsync(url, PAYMENT_RETURN_URL);
  } catch {
    // Fall back to a plain in-app browser if an auth session can't start.
    await WebBrowser.openBrowserAsync(url).catch(() => {});
  }
  return true;
}
