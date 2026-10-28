// Must be imported before anything that touches Prisma.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://qitah@127.0.0.1:5433/qitah_test?schema=public';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-payment-webhook-secret';
process.env.CARRIER_WEBHOOK_SECRET ??= 'test-carrier-webhook-secret';
process.env.PUBLIC_BASE_URL ??= 'http://127.0.0.1:4999';
process.env.AUTH_MODE = 'local';
process.env.RATE_LIMIT_SCALE ??= '1000';
