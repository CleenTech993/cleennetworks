import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES } from "../src/lib/seo";

// A page with no robots tag is indexable by default, so a new page added without thinking would
// quietly end up in search results. These checks force every top-level page to be a decision:
// either registered in PUBLIC_PAGES (with its tags) or explicitly kept out with noindex.
const ROUTES = join(__dirname, "../src/routes");
const files = readdirSync(ROUTES).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
const read = (f: string) => readFileSync(join(ROUTES, f), "utf8");
const stem = (f: string) => f.replace(/\.(tsx|ts)$/, "");

// Top-level pages: a page is a child (and inherits its layout's robots tag) only if a layout file named
// after its first segment exists: tenant.customers -> tenant.tsx. Everything else is top-level,
// including "p.$slug" (the /p/<slug> customer Wi-Fi portal) and "support-session.$sessionId".
const stems = new Set(files.map(stem));
const MACHINE = new Set(["__root", "robots[.]txt", "sitemap[.]xml"]); // not HTML pages
const topLevel = files.filter((f) => {
  const name = stem(f);
  if (MACHINE.has(name)) return false;
  const first = name.split(".")[0]!;
  return first === name || !stems.has(first);
});
const publicStems = new Set(PUBLIC_PAGES.map((p) => (p.path === "/" ? "index" : p.path.slice(1))));

describe("every top-level page is either public or kept out of search", () => {
  const pages = topLevel.filter((f) => !f.startsWith("_") && !f.startsWith("README"));

  it("finds the pages (sanity check on the scan itself)", () => {
    expect(pages.map(stem)).toEqual(
      expect.arrayContaining([
        "index",
        "login",
        "tenant",
        "super-admin",
        "portal",
        "p.$slug",
        "support-session.$sessionId",
      ]),
    );
  });

  for (const f of pages) {
    const name = stem(f);
    if (publicStems.has(name)) {
      const path = name === "index" ? "/" : `/${name}`;
      it(`${name}: public page, registered at ${path} and built with pageHead`, () => {
        const src = read(f);
        expect(src).toContain("pageHead(");
        expect(src).toContain(`createFileRoute("${path}")`);
      });
    } else {
      it(`${name}: private page, is marked noindex`, () => {
        const src = read(f);
        expect(src.includes("noindex")).toBe(true);
      });
    }
  }

  it("has a route file for every registered public page", () => {
    for (const p of PUBLIC_PAGES) {
      const name = p.path === "/" ? "index" : p.path.slice(1);
      expect(files.map(stem), `no route for ${p.path}`).toContain(name);
    }
  });

  it("never lets a page opt in to indexing twice or from the wrong place", () => {
    for (const f of pages) {
      const src = read(f);
      expect(
        src.includes("pageHead(") &&
          (src.includes("noindexHead(") || src.includes("noindex, nofollow")),
        f,
      ).toBe(false);
    }
  });
});
