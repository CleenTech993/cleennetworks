/** RouterOS PPP and hotspot limits use rx/tx from the router's perspective. */
export function routerOsRateLimit(
  downloadKbps: number | null | undefined,
  uploadKbps: number | null | undefined,
): string | null {
  const dl =
    downloadKbps && Number.isFinite(downloadKbps) && downloadKbps > 0
      ? Math.round(downloadKbps)
      : 0;
  const ul =
    uploadKbps && Number.isFinite(uploadKbps) && uploadKbps > 0 ? Math.round(uploadKbps) : 0;
  if (!dl && !ul) return null;
  const side = (k: number) => (k ? `${k}k` : "0");
  return `${side(ul)}/${side(dl)}`;
}
