// Phone helpers. Pure functions (no env / DB access) so they are unit-testable.

/** Normalises Kenyan numbers to the 254XXXXXXXXX form used by M-Pesa. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

/** True for a normalised Kenyan mobile number (254 7XX / 254 1XX, 12 digits). */
export function isKenyanMobile(normalized: string): boolean {
  return /^254[17]\d{8}$/.test(normalized);
}
