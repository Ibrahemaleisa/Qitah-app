/**
 * Runtime mode.
 *
 * - Remote mode: `EXPO_PUBLIC_API_BASE_URL` is set (e.g. `http://127.0.0.1:4103`). Catalog, auth,
 *   garage, addresses, cart, checkout, orders and notifications come from the Qitah API.
 * - Demo mode: the variable is unset. Everything runs on the bundled SAMPLE data and the simulated
 *   services, exactly as before (the jest suite relies on this).
 *
 * `EXPO_PUBLIC_*` variables are inlined at build time, so this must be read via the literal
 * `process.env.EXPO_PUBLIC_API_BASE_URL` expression.
 */
const raw = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export const API_BASE_URL = raw.trim().replace(/\/+$/, '');

export const isRemote = API_BASE_URL.length > 0;
