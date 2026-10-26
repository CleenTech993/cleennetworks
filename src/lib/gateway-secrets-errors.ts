// Turns a database error from the credentials table into something the person saving can act on.
// Pure (no server imports) so it can be unit-tested and reused by the status check.

export type StoreProblem = "missing" | "denied" | "error";

export const MIGRATION_FILE = "20261028000000_platform_gateway_secrets.sql";

/** PostgREST says PGRST205 / "schema cache" for an unknown table; Postgres itself says 42P01. */
export function classifyStoreError(err: { code?: string | null; message?: string | null } | null | undefined): StoreProblem {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  if (code === "PGRST205" || code === "42P01" || /schema cache|does not exist|could not find the table/i.test(msg)) return "missing";
  if (code === "42501" || /permission denied/i.test(msg)) return "denied";
  return "error";
}

export function storeProblemMessage(problem: StoreProblem, code?: string | null): string {
  if (problem === "missing") {
    return `The database is missing the table that stores payment credentials. Apply the migration ${MIGRATION_FILE} (Supabase, SQL editor), then try again.`;
  }
  if (problem === "denied") {
    return `The server is not allowed to write to the credentials table. Re-run the grants at the end of the migration ${MIGRATION_FILE}.`;
  }
  return `Could not save the credential (database error ${code || "unknown"}). Check the server log for details.`;
}
