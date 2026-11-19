// Supabase identifies a migration by its 14-digit version number, so two files with the same number cannot
// both exist. When that happened, one of them (a security fix) was silently dropped by an automated cleanup
// and the hole it closed re-opened. This test makes a duplicate fail loudly, before it can be merged.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const NAME = /^(\d{14})_.+\.sql$/;

/** Returns each version that is used by more than one file, with the files that share it. */
export function duplicateVersions(files: string[]): Record<string, string[]> {
  const byVersion: Record<string, string[]> = {};
  for (const f of files) {
    const m = NAME.exec(f);
    if (m) (byVersion[m[1]] ??= []).push(f);
  }
  return Object.fromEntries(Object.entries(byVersion).filter(([, list]) => list.length > 1));
}

describe("duplicateVersions (the checker itself)", () => {
  it("finds files that share a version", () => {
    expect(
      duplicateVersions([
        "20261104000000_mandatory_mfa.sql",
        "20261104000000_lock_bootstrap_tenant.sql",
        "20261105000000_login_abuse_protection.sql",
      ]),
    ).toEqual({
      "20261104000000": [
        "20261104000000_mandatory_mfa.sql",
        "20261104000000_lock_bootstrap_tenant.sql",
      ],
    });
  });
  it("is quiet when every version is unique", () => {
    expect(duplicateVersions(["20261104000000_a.sql", "20261105000000_b.sql"])).toEqual({});
  });
});

describe("supabase/migrations", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

  it("every migration is named <14-digit version>_<name>.sql", () => {
    expect(files.filter((f) => !NAME.test(f))).toEqual([]);
  });

  it("no two migrations share a version number (pick a version higher than every existing one)", () => {
    expect(duplicateVersions(files)).toEqual({});
  });
});
