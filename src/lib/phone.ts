/** Safaricom-style Kenyan mobile in normalized 2547XXXXXXXX / 2541XXXXXXXX form. */
export function isValidKenyanMobile(msisdn: string): boolean {
  return /^254[17]\d{8}$/.test(msisdn);
}
