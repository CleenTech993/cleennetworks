// Shared inventory constants + small pure helpers used by the Inventory pages.

export const ITEM_CATEGORIES = [
  { value: "router", label: "Router" },
  { value: "ont", label: "ONT" },
  { value: "access_point", label: "Access point" },
  { value: "switch", label: "Switch" },
  { value: "cable", label: "Cable" },
  { value: "other", label: "Other" },
] as const;

/** Individual units can be anything except bulk cable. */
export const DEVICE_CATEGORIES = ITEM_CATEGORIES.filter((c) => c.value !== "cable");

export const DEVICE_STATUSES = [
  { value: "in_stock", label: "In stock" },
  { value: "deployed", label: "Deployed" },
  { value: "faulty", label: "Faulty" },
  { value: "retired", label: "Retired" },
] as const;

export const MOVE_REASONS = {
  received: "Received",
  issued: "Issued",
  returned: "Returned",
  damaged: "Damaged / lost",
  adjustment: "Correction",
} as const;
export type MoveReason = keyof typeof MOVE_REASONS;

export const categoryLabel = (v: string) => ITEM_CATEGORIES.find((c) => c.value === v)?.label ?? v;
export const statusLabel = (v: string) => DEVICE_STATUSES.find((s) => s.value === v)?.label ?? v;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d{1,2})(\.(25[0-5]|2[0-4]\d|1?\d{1,2})){3}$/;
export const isValidIpv4 = (s: string) => IPV4.test(s.trim());

/** "AA-BB-CC-DD-EE-FF", "aabb.ccdd.eeff" or "aabbccddeeff" -> "aa:bb:cc:dd:ee:ff"; null if not a MAC. */
export function normalizeMac(input: string): string | null {
  const hex = input.trim().toLowerCase().replace(/[:\-.\s]/g, "");
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}

export type StockLike = { quantity: number | string; reorder_level: number | string };
export const isLowStock = (i: StockLike) => Number(i.reorder_level) > 0 && Number(i.quantity) <= Number(i.reorder_level);

export function formatQty(quantity: number | string, unit: string): string {
  const n = Number(quantity);
  const text = Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit === "m" ? `${text} m` : `${text}`;
}

export function customerLabel(c: { full_name: string | null; phone: string | null; pppoe_username: string | null; id: string }): string {
  return c.full_name?.trim() || c.phone || c.pppoe_username || `Customer ${c.id.slice(0, 6)}`;
}

/** Turns database / API errors into something a person can act on. */
export function describeError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? "Something went wrong";
  if (err?.code === "23505" || /duplicate key/i.test(msg)) return "That serial number is already registered.";
  if (err?.code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "You don't have permission to do that.";
  }
  return msg;
}

/** "0712 345 678", "+254712345678" or "254712345678" -> "254712345678"; null if it isn't a plausible phone number. */
export function normalizeAlertNumber(input: string): string | null {
  // Only digits plus the usual separators; anything else (letters, ; etc.) is not a phone number.
  if (!/^\+?[\d\s\-().]+$/.test(input.trim())) return null;
  let d = input.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  else if (/^[17]\d{8}$/.test(d)) d = `254${d}`;
  return /^\d{9,15}$/.test(d) ? d : null;
}
