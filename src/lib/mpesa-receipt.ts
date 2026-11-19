const RECEIPT_CODE = /^[A-Z0-9]{6,40}$/;
const CONFIRMED_RECEIPT = /\b([A-Z0-9]{8,12})\s+CONFIRMED\b/gi;

export function extractMpesaReceiptCode(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  if (RECEIPT_CODE.test(normalized)) return normalized;

  const matches = [...normalized.matchAll(CONFIRMED_RECEIPT)];
  if (matches.length !== 1) return null;
  return matches[0][1] ?? null;
}