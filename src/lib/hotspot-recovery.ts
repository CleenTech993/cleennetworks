import { expiryFrom } from "@/lib/duration";

export function packageDurationSeconds(value: number | null, unit: string | null): number | null {
  if (!value || !unit || !Number.isFinite(value) || value <= 0) return null;
  const seconds = Date.parse(expiryFrom(value, unit, 0)) / 1000;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

export function recoveryAllowance(
  durationSeconds: number,
  connectedSeconds: number,
  maximumRestorableSeconds = Number.POSITIVE_INFINITY,
): { eligible: boolean; restoredSeconds: number } {
  const duration = Math.max(0, Math.floor(durationSeconds));
  const used = Math.max(0, Math.floor(connectedSeconds));
  const maximumRestorable = Math.max(0, Math.floor(maximumRestorableSeconds));
  const restoredSeconds = Math.min(maximumRestorable, Math.max(0, duration - used));
  return {
    eligible: duration > 0 && restoredSeconds * 2 >= duration,
    restoredSeconds,
  };
}
