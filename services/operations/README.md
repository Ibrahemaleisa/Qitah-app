# Qitah operations — sandbox foundation

This service is **not production-ready**. Routes are unauthenticated; payments and shipping are simulated; the shipping rate is a fixed example. Do not expose to the internet or onboard real customers.

Run locally:
1. `cd services/operations && npm install`
2. `cp .env.example .env`
3. `docker compose up -d`
4. `npx prisma db push && npx prisma generate`
5. `npm run dev` (localhost:4000)
6. `npm test` and `npm run typecheck`

Sandbox APIs: /health, /api/merchants, /api/products, /api/offers, /api/quote, /api/sandbox/orders, /api/sandbox/orders/:id/pay, /api/orders, /api/suborders/:id/status, /api/shipments/:id/status, /api/returns, /api/operations/summary.

**Before deployment:** verified authentication and merchant RBAC; production shipping quotes and grouping; secure payment webhooks; stock reservation expiry; refunds and financial ledger; tax invoices; event processing; rate limits; production monitoring; migration discipline. Current sandbox grouping is location-based, not carrier-verified. Do not represent it as a real quote.
