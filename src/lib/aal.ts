/** True when a Supabase access-token's claims show a completed MFA challenge (assurance level 2). */
export function isAal2(claims: { aal?: unknown } | null | undefined): boolean {
  return claims?.aal === "aal2";
}
