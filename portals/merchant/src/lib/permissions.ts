import type { MerchantRole } from "./types";

/**
 * What each merchant role can do in the UI. The API enforces the same rules (requireMerchant with
 * a minimum role); this only hides or disables what would fail anyway.
 *   STAFF   — orders and stock
 *   MANAGER — + catalog (offers, products, import), locations, returns, settlements, activity
 *   OWNER   — + staff, verification documents
 */
export type Permission =
  | "orders"
  | "stock"
  | "catalog.edit"
  | "locations.manage"
  | "returns"
  | "settlements"
  | "activity"
  | "staff"
  | "verification"
  | "balance";

const MIN_ROLE: Record<Permission, MerchantRole> = {
  orders: "STAFF",
  stock: "STAFF",
  "catalog.edit": "MANAGER",
  "locations.manage": "MANAGER",
  returns: "MANAGER",
  settlements: "MANAGER",
  activity: "MANAGER",
  balance: "MANAGER",
  staff: "OWNER",
  verification: "OWNER",
};

const RANK: Record<MerchantRole, number> = { STAFF: 1, MANAGER: 2, OWNER: 3 };

export function can(role: MerchantRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[MIN_ROLE[permission]];
}
