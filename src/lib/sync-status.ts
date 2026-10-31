// How healthy a router's customer sync looks, from when it last synced. The router asks the platform
// for its vouchers and PPPoE users every ~2 minutes; if that stops, new customers can never connect.

export type SyncLevel = "ok" | "warn" | "bad";

export const SYNC_INTERVAL_MIN = 2;

export function syncStatus(
  lastSyncAt: string | null | undefined,
  now: number = Date.now(),
): { level: SyncLevel; label: string; detail: string } {
  if (!lastSyncAt) {
    return {
      level: "warn",
      label: "no sync recorded yet",
      detail:
        "Either this router has not synced since this was added, or it is not syncing at all. If customers cannot connect, copy the check below and run it on the router.",
    };
  }
  const ageMin = Math.max(0, Math.round((now - new Date(lastSyncAt).getTime()) / 60_000));
  const ago = ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin} min ago` : ageMin < 1440 ? `${Math.floor(ageMin / 60)} h ago` : `${Math.floor(ageMin / 1440)} d ago`;
  if (ageMin <= SYNC_INTERVAL_MIN * 3) {
    return { level: "ok", label: `last synced ${ago}`, detail: "Vouchers and PPPoE users reach this router within a couple of minutes." };
  }
  if (ageMin <= 15) {
    return { level: "warn", label: `last synced ${ago}`, detail: "A little late. New vouchers and PPPoE users may not be on the router yet." };
  }
  return {
    level: "bad",
    label: `last synced ${ago}`,
    detail:
      "This router has stopped syncing, so customers created since then cannot connect (vouchers loop on \"Activating\"). Run the check below on the router, or generate a new setup command if the token is out of date.",
  };
}
