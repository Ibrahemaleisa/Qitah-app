import type { Config } from './config.js';
import { SandboxCarrier } from './providers/carrier/sandbox.js';
import type { CarrierAdapter } from './providers/carrier/types.js';
import { SandboxPaymentProvider } from './providers/payment/sandbox.js';
import type { PaymentProvider } from './providers/payment/types.js';
import { createUploads, type Uploads } from './services/uploads.js';

export type Ctx = {
  config: Config;
  carrier: CarrierAdapter;
  payments: PaymentProvider;
  uploads: Uploads;
};

export function createContext(config: Config): Ctx {
  return {
    config,
    carrier: new SandboxCarrier(config.PUBLIC_BASE_URL),
    payments: new SandboxPaymentProvider(config.PUBLIC_BASE_URL, config.PAYMENT_WEBHOOK_SECRET),
    uploads: createUploads(config),
  };
}
