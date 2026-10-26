import { RemotePayment } from '@/features/remote/RemotePayment';

/** Remote mode: waits for the server to confirm payment for `orderId` (polls; supports retry). */
export default function PaymentScreen() {
  return <RemotePayment />;
}
