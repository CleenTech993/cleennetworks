// A voucher becomes a hotspot user on the router only when the router next runs its sync script
// (every ~2 minutes). A voucher bought through the portal is seconds old when it is redeemed, so
// logging the customer in immediately fails ("invalid username or password") and they get stuck.
//
// Each sync records when its snapshot of the database was taken (routers.last_sync_at). A voucher
// that existed at that moment is on the router, so the portal waits for that before sending the
// customer to the hotspot login. Pure, so it is unit-testable.

/** Time for the router to run the script it has just downloaded. */
export const SYNC_SETTLE_MS = 10_000;

export function voucherReady(args: {
  voucherCreatedAt: string;
  lastSyncAt: string | null | undefined;
  now?: number;
}): boolean {
  if (!args.lastSyncAt) return false;
  const created = Date.parse(args.voucherCreatedAt);
  const synced = Date.parse(args.lastSyncAt);
  if (Number.isNaN(created) || Number.isNaN(synced)) return false;
  return synced >= created && (args.now ?? Date.now()) - synced >= SYNC_SETTLE_MS;
}
