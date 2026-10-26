import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Deep link target for `qitah://checkout/return?order=…` (the payment provider's return URL).
 * The result is never read from the URL: we hand over to the payment screen, which asks the server.
 */
export default function PaymentReturn() {
  const { order } = useLocalSearchParams<{ order?: string }>();
  if (!order) return <Redirect href="/orders" />;
  return <Redirect href={{ pathname: '/checkout/payment', params: { orderId: order } }} />;
}
