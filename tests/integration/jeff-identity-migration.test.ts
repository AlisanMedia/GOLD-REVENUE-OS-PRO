import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import nextConfig from "../../apps/web/next.config";
import { translator } from "../../apps/web/src/lib/i18n/core";
import { jeffHref, jeffSearchSchema } from "../../apps/web/src/lib/jeff/read-model";
import { JEFF_TELEGRAM_HANDLE, matchesJeffBusinessIdentity } from "../../packages/contracts/src/jeff-identity";

describe("single Jeff identity migration", () => {
  it("uses Jeff in both localized Admin navigation and canonical campaign URLs", () => {
    expect(translator("tr-TR")("Jeff AI Operations")).toBe("Jeff AI Operasyonları");
    expect(translator("en-US")("Jeff AI Operations")).toBe("Jeff AI Operations");
    expect(readFileSync("apps/web/src/components/admin-navigation.tsx", "utf8")).toContain('href:"/admin/jeff-operations",label:"Jeff AI Operations"');
    expect(jeffHref(jeffSearchSchema.parse({}))).toMatch(/^\/admin\/jeff-operations\?/u);
    expect(readFileSync("apps/web/src/components/campaign-controls.tsx", "utf8")).toContain('href="/admin/jeff-operations"');
  });
  it("permanently redirects old bookmarks and every nested path to the fixed Jeff route", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/admin/polat-operations/:path*", destination: "/admin/jeff-operations/:path*", permanent: true });
    expect(redirects.every(rule => !rule.destination.startsWith("http"))).toBe(true);
  });
  it("never authenticates the Business account by username alone", () => {
    expect(JEFF_TELEGRAM_HANDLE).toBe("@jeffryfx");
    const user = { id: 734001, is_bot: false, username: "jeffryfx" };
    expect(matchesJeffBusinessIdentity(user, "734001")).toBe(true);
    expect(matchesJeffBusinessIdentity({ ...user, username: "JEFFRYFX" }, "734001")).toBe(true);
    expect(matchesJeffBusinessIdentity(user, "734002")).toBe(false);
    expect(matchesJeffBusinessIdentity({ ...user, id: undefined }, "734001")).toBe(false);
    expect(matchesJeffBusinessIdentity({ ...user, is_bot: true }, "734001")).toBe(false);
    expect(matchesJeffBusinessIdentity({ ...user, username: "someone_else" }, "734001")).toBe(false);
    expect(matchesJeffBusinessIdentity({ ...user, username: undefined }, "734001")).toBe(false);
  });
  it("rejects legacy identity reintroduction in active source; only frozen historical domain data is excluded", () => {
    const violations: string[] = [];
    const roots = ["apps/web/src", "apps/web/scripts", "packages", "scripts", "supabase/functions"];
    function scan(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name), name = relative(".", path).replaceAll("\\", "/");
        if (entry.isDirectory()) {
          if (["node_modules", ".next"].includes(entry.name)) continue;
          scan(path);
        } else if (/\.(?:tsx?|mjs|mts|css|json)$/u.test(path)) {
          const frozen = ["identity-domains-v1.ts", "identity-names-v1.ts", "identity-wire-v1.ts"].map(file => "packages/contracts/src/historical/" + file);
          if (frozen.includes(name)) continue;
          if (/Polat|POLAT_|\/polat-operations/iu.test(readFileSync(path, "utf8"))) violations.push(name);
          if (/polat/iu.test(entry.name)) violations.push(name + " (filename)");
        }
      }
    }
    roots.forEach(scan);
    expect(violations).toEqual([]);
  });
});
