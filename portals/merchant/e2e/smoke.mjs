#!/usr/bin/env node
/**
 * Merchant portal smoke test — drives the real portal (Next.js) against the real API.
 *
 *   1. register a new merchant in the UI → status screen (UNDER_REVIEW)
 *   2. approve it through the ops API
 *   3. log out / log in → dashboard
 *   4. add a pickup location
 *   5. create a product (with fitment) + an offer with stock
 *   6. place a paid customer order through the customer API → it appears live (toast + row)
 *   7. accept → start packing → mark ready → shipment appears; ops buys a sandbox label → SBX tracking
 *   8. security: the proxy refuses /v1/ops/summary (404) and cross-site POSTs (403)
 *   9. STAFF cannot see or open the staff page
 *
 * Prerequisites: API on API_URL (seeded, RATE_LIMIT_SCALE=1000 recommended) and the portal on PORTAL_URL.
 *   node e2e/smoke.mjs
 * Screenshots go to e2e/shots/ (gitignored).
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORTAL = process.env.PORTAL_URL ?? "http://localhost:3101";
const API = process.env.API_URL ?? "http://127.0.0.1:4101";
const PASSWORD = process.env.SEED_PASSWORD ?? "Qitah-Sandbox-2026!";
const OPS_EMAIL = "ops.admin@qitah.test";
const STAFF_EMAIL = "staff@riyadh-center.qitah.test";
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(SHOTS, { recursive: true });

const rand = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const RUN = Date.now().toString(36);
const results = [];

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: e });
    console.log(`  ✗ ${name}\n    ${String(e?.stack ?? e).split("\n").slice(0, 4).join("\n    ")}`);
    throw e;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ── API helpers (ops + customer act directly on the API, as other apps would)
async function apiJson(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json;
}

async function apiLogin(email) {
  return (await apiJson("POST", "/v1/auth/login", { email, password: PASSWORD })).accessToken;
}

/** Customer journey: OTP sign-in → address → checkout plan → checkout → sandbox payment success. */
async function placePaidOrder(offerId) {
  const phone = `+9665${rand(8)}`;
  const otp = await apiJson("POST", "/v1/auth/otp/request", { phone });
  const session = await apiJson("POST", "/v1/auth/otp/verify", { phone, code: otp.sandboxCode, name: "عميل تجريبي" });
  const token = session.accessToken;
  const address = await apiJson(
    "POST",
    "/v1/me/addresses",
    { kind: "home", label: "المنزل", city: "riyadh", district: "النرجس", street: "شارع الاختبار 12", contactName: "عميل تجريبي", phone },
    token,
  );
  const plan = await apiJson("POST", "/v1/checkout/plan", { addressId: address.id, lines: [{ offerId, quantity: 1 }] }, token);
  const option = plan.options.find((o) => o.groups.some((g) => g.lines.some((l) => l.offerId === offerId))) ?? plan.options[0];
  assert(option, `checkout plan has an option (${JSON.stringify(plan).slice(0, 200)})`);
  const order = await apiJson("POST", "/v1/checkout", { planId: option.planId, idempotencyKey: `smoke-${RUN}-${rand(6)}`, paymentMethod: "mada" }, token);
  assert(order.payment?.redirectUrl, "checkout returned a sandbox payment page");
  const pay = await fetch(order.payment.redirectUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "outcome=success", redirect: "manual" });
  assert(pay.status === 303 || pay.ok, `sandbox payment accepted (${pay.status})`);
  return order;
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function uiLogin(page, email) {
  await page.goto(`${PORTAL}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${PORTAL}/`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
}

async function main() {
  console.log(`Merchant portal smoke test — portal ${PORTAL}, API ${API}\n`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: "ar-SA", viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const cr = `7${rand(9)}`;
  const ownerEmail = `owner.${RUN}@smoke.qitah.test`;
  const storeAr = `متجر الاختبار ${RUN}`;
  const partNumber = `QX-${rand(5)}-${RUN.toUpperCase()}`;
  const sku = `SMK-${RUN.toUpperCase()}`;
  const locationName = `مستودع الاختبار ${RUN}`;
  let merchantId;
  let offerId;
  let order;
  let merchantOrderId;
  const ops = await apiLogin(OPS_EMAIL);

  try {
    await step("guarded pages redirect to /login when signed out", async () => {
      await page.goto(`${PORTAL}/orders`);
      await page.waitForURL(/\/login\?next=%2Forders/);
    });

    await step("register a new merchant (3 steps + review)", async () => {
      await page.goto(`${PORTAL}/register`);
      await page.fill('[name="legalName"]', `مؤسسة اختبار قطعة ${RUN}`);
      await page.fill('[name="displayNameAr"]', storeAr);
      await page.fill('[name="displayNameEn"]', `Smoke Store ${RUN}`);
      await page.fill('[name="crNumber"]', cr);
      await page.selectOption('[name="city"]', "jeddah");
      await page.fill('[name="contactPhone"]', `05${rand(8)}`);
      await page.fill('[name="contactEmail"]', `contact.${RUN}@smoke.qitah.test`);
      await shot(page, "01-register-business");
      await page.getByRole("button", { name: "التالي" }).click();
      await page.getByTestId("register-step-1").waitFor();
      await page.fill('[name="ownerName"]', "مالك الاختبار");
      await page.fill('[name="ownerEmail"]', ownerEmail);
      await page.fill('[name="ownerPassword"]', PASSWORD);
      await page.fill('[name="ownerConfirm"]', PASSWORD);
      await page.getByRole("button", { name: "التالي" }).click();
      await page.getByTestId("register-step-2").waitFor();
      await page.fill('[name="locationName"]', "الفرع الرئيسي");
      await page.selectOption('[name="locationCity"]', "jeddah");
      await page.fill('[name="locationDistrict"]', "الروضة");
      await page.fill('[name="locationStreet"]', "شارع الأمير سلطان");
      await page.fill('[name="locationPhone"]', `05${rand(8)}`);
      await page.getByRole("button", { name: "التالي" }).click();
      await page.getByTestId("register-step-3").waitFor();
      await page.getByRole("button", { name: "إرسال الطلب" }).click();
      await page.waitForURL(`${PORTAL}/`);
      const panel = page.getByTestId("status-panel");
      await panel.waitFor();
      assert((await panel.getAttribute("data-status")) === "UNDER_REVIEW", "new store is UNDER_REVIEW");
      await shot(page, "02-status-under-review");
    });

    await step("approve the store as ops (API)", async () => {
      const list = await apiJson("GET", `/v1/ops/merchants?q=${cr}`, undefined, ops);
      merchantId = list.items[0]?.id;
      assert(merchantId, "registered merchant found by CR");
      await apiJson("POST", `/v1/ops/merchants/${merchantId}/approve`, {}, ops);
    });

    await step("log out and log back in → dashboard", async () => {
      await page.getByTestId("user-menu").click();
      await page.getByRole("menuitem", { name: "تسجيل الخروج" }).click();
      await page.waitForURL(/\/login/);
      await uiLogin(page, ownerEmail);
      await page.getByTestId("queue-new").waitFor();
      assert((await page.getByTestId("status-panel").count()) === 0, "approved store shows the dashboard, not the status screen");
      await shot(page, "03-dashboard");
    });

    await step("add a pickup location", async () => {
      await page.goto(`${PORTAL}/locations`);
      await page.getByTestId("add-location").click();
      const form = page.getByTestId("location-form");
      await form.locator('[name="name"]').fill(locationName);
      await form.locator('[name="city"]').selectOption("riyadh");
      await form.locator('[name="district"]').fill("السلي");
      await form.locator('[name="street"]').fill("شارع الصناعية");
      await form.locator('[name="contactPhone"]').fill(`05${rand(8)}`);
      await page.getByTestId("save-location").click();
      await page.getByTestId("location-card").filter({ hasText: locationName }).waitFor();
    });

    await step("create a product (with fitment) and an offer with stock", async () => {
      await page.goto(`${PORTAL}/catalog/new`);
      await page.getByTestId("catalog-search").fill(partNumber);
      await page.getByText("لا توجد نتائج").waitFor();
      await page.getByTestId("create-product").click();
      const form = page.getByTestId("product-form");
      await form.locator('[name="nameAr"]').fill(`حساس اختبار ${RUN}`);
      await form.locator('[name="nameEn"]').fill(`Smoke sensor ${RUN}`);
      await form.locator('[name="categoryId"] option').nth(1).waitFor({ state: "attached" });
      await form.locator('[name="categoryId"]').selectOption({ index: 1 });
      await form.locator('[name="brand"]').fill("SmokeParts");
      await form.locator('[name="partNumber"]').fill(partNumber);
      await form.locator('[name="weightGrams"]').fill("350");
      await form.locator('[name="lengthCm"]').fill("12");
      await form.locator('[name="widthCm"]').fill("8");
      await form.locator('[name="heightCm"]').fill("5");
      await page.getByTestId("add-fitment").click();
      await page.getByTestId("fit-make").selectOption({ index: 1 });
      await page.getByTestId("fit-model").selectOption({ index: 1 });
      await shot(page, "04-product-form");
      await page.getByTestId("submit-product").click();
      const offer = page.getByTestId("offer-form");
      await offer.waitFor();
      const locValue = await offer.locator('[name="locationId"] option', { hasText: locationName }).getAttribute("value");
      await offer.locator('[name="locationId"]').selectOption(locValue);
      await offer.locator('[name="sku"]').fill(sku);
      await offer.locator('[name="price"]').fill("123.45");
      await offer.locator('[name="stock"]').fill("5");
      await page.getByTestId("submit-offer").click();
      await page.waitForURL(`${PORTAL}/catalog`);
      const row = page.locator(`[data-testid="offer-row"][data-sku="${sku}"]`);
      await row.waitFor();
      assert((await row.innerText()).includes("123.45"), "price shown as 123.45 SAR");
      assert((await row.getByTestId("available").innerText()) === "5", "5 units available");
      await shot(page, "05-catalog");
      const found = await page.evaluate(async ({ mid, sku }) => {
        const r = await fetch(`/api/proxy/v1/merchants/${mid}/offers?q=${encodeURIComponent(sku)}`);
        return r.json();
      }, { mid: merchantId, sku });
      offerId = found.items.find((o) => o.sku === sku)?.id;
      assert(offerId, "offer readable through the BFF proxy");
      assert(found.items[0].priceHalalas === 12345, "123.45 SAR stored as 12345 halalas");
    });

    await step("a paid order placed via the API appears live (toast + row, no reload)", async () => {
      await page.goto(`${PORTAL}/orders?status=NEW`);
      await page.waitForSelector('[data-testid="realtime-mode"][data-mode="live"]');
      order = await placePaidOrder(offerId);
      await page.getByTestId("toast").filter({ hasText: "طلب جديد" }).first().waitFor({ timeout: 20_000 });
      const row = page.locator('[data-testid="order-row"]').filter({ hasText: order.number });
      await row.waitFor({ timeout: 20_000 });
      await shot(page, "06-orders-live");
      await row.getByRole("link").first().click();
      await page.waitForURL(/\/orders\/[^/]+$/);
      merchantOrderId = page.url().split("/").pop();
    });

    await step("accept → start packing → ready for pickup → shipment", async () => {
      const detail = page.getByTestId("order-detail");
      await detail.waitFor();
      assert((await detail.getAttribute("data-status")) === "NEW", "order starts NEW");
      assert((await page.getByTestId("item-qty").first().innerText()) === "1", "quantity 1");
      await page.getByTestId("sla").waitFor();
      await page.getByTestId("action-accept").click();
      await page.locator('[data-testid="order-detail"][data-status="ACCEPTED"]').waitFor();
      await page.getByText("المستلم").waitFor(); // full address visible once accepted
      await page.getByTestId("action-pack").click();
      await page.locator('[data-testid="order-detail"][data-status="PACKING"]').waitFor();
      await page.getByTestId("action-ready").click();
      await page.locator('[data-testid="order-detail"][data-status="READY_FOR_PICKUP"]').waitFor();
      await page.getByTestId("shipment").first().waitFor();
    });

    await step("ops buys a sandbox label → tracking number + label link appear live", async () => {
      const mo = await page.evaluate(async ({ mid, id }) => (await fetch(`/api/proxy/v1/merchants/${mid}/orders/${id}`)).json(), { mid: merchantId, id: merchantOrderId });
      const shipmentId = mo.shipments[0].id;
      await apiJson("POST", `/v1/ops/shipments/${shipmentId}/label`, {}, ops);
      const tracking = page.getByTestId("tracking-number").first();
      await page.waitForFunction(() => /^SBX/i.test(document.querySelector('[data-testid="tracking-number"]')?.textContent ?? ""), null, { timeout: 20_000 });
      assert(/^SBX/i.test(await tracking.innerText()), "SBX tracking number shown");
      await page.getByText("بيئة تجريبية / Sandbox").first().waitFor();
      await page.getByTestId("label-link").waitFor();
      await shot(page, "07-order-shipment");
    });

    await step("proxy allowlist refuses /v1/ops/summary (404) even for a signed-in user", async () => {
      const r = await page.evaluate(async () => {
        const res = await fetch("/api/proxy/v1/ops/summary");
        return { status: res.status, body: await res.json() };
      });
      assert(r.status === 404, `expected 404, got ${r.status}`);
      const traversal = await page.evaluate(async () => (await fetch("/api/proxy/v1/merchants/..%2F..%2Fv1%2Fops%2Fsummary")).status);
      assert(traversal === 404, `encoded traversal refused (${traversal})`);
    });

    await step("CSRF: cross-site mutating requests are refused", async () => {
      const res = await fetch(`${PORTAL}/api/proxy/v1/merchants/${merchantId}/notifications/read`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      const noOrigin = await fetch(`${PORTAL}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert(noOrigin.status === 403, `missing Origin refused (${noOrigin.status})`);
    });

    await step("session cookies are httpOnly and invisible to page scripts", async () => {
      const cookies = await ctx.cookies(PORTAL);
      const at = cookies.find((c) => c.name === "qm_at");
      const rt = cookies.find((c) => c.name === "qm_rt");
      assert(at?.httpOnly && rt?.httpOnly, "both session cookies are httpOnly");
      assert(at.sameSite === "Lax" && rt.sameSite === "Lax", "SameSite=Lax");
      const visible = await page.evaluate(() => document.cookie);
      assert(!visible.includes("qm_"), "document.cookie does not expose tokens");
    });

    await step("STAFF cannot see or open the staff page", async () => {
      const staffCtx = await browser.newContext({ locale: "ar-SA", viewport: { width: 1360, height: 900 } });
      const sp = await staffCtx.newPage();
      sp.setDefaultTimeout(15_000);
      await uiLogin(sp, STAFF_EMAIL);
      const nav = sp.getByRole("navigation", { name: "القائمة الرئيسية" }).first();
      await nav.getByRole("link", { name: "الطلبات" }).waitFor();
      assert((await nav.getByRole("link", { name: "فريق العمل" }).count()) === 0, "no staff link in STAFF navigation");
      assert((await nav.getByRole("link", { name: "المستحقات والتسويات" }).count()) === 0, "no settlements link for STAFF");
      await sp.goto(`${PORTAL}/staff`);
      await sp.getByTestId("forbidden").waitFor();
      await shot(sp, "08-staff-forbidden");
      await sp.goto(`${PORTAL}/catalog`);
      await sp.getByTestId("offers-table").waitFor();
      assert((await sp.getByTestId("add-offer").count()) === 0, "STAFF has no add-offer button");
      assert((await sp.getByTestId("stock-input").count()) > 0, "STAFF can edit stock");
      const api403 = await sp.evaluate(async () => {
        const me = await (await fetch("/api/proxy/v1/me")).json();
        return (await fetch(`/api/proxy/v1/merchants/${me.merchants[0].id}/staff`)).status;
      });
      assert(api403 === 403, `API also refuses STAFF on /staff (${api403})`);
      await staffCtx.close();
    });

    await step("mobile layout renders (390px)", async () => {
      const mctx = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await mctx.addCookies(await ctx.cookies(PORTAL));
      const mp = await mctx.newPage();
      await mp.goto(`${PORTAL}/orders/${merchantOrderId}`);
      await mp.getByTestId("order-detail").waitFor();
      const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `no horizontal page scroll on mobile (overflow ${overflow}px)`);
      await shot(mp, "09-mobile-order");
      await mctx.close();
    });

    assert(consoleErrors.length === 0, `no uncaught page errors: ${consoleErrors.join(" | ")}`);
  } finally {
    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} steps passed${order ? ` · order ${order.number}` : ""}${merchantId ? ` · merchant ${merchantId}` : ""}`);
    if (failed.length) process.exitCode = 1;
  }
}

main().catch(() => {
  process.exitCode = 1;
});
