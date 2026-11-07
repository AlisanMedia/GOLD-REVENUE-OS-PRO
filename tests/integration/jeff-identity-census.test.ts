import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIdentityCensus, identityCensusPath } from "../../scripts/jeff-identity-inventory.mjs";

describe("complete explained identity reference inventory", () => {
  it("accounts for every retained reference, including inventory filenames, without hidden source exclusions", () => {
    const stored = JSON.parse(readFileSync(identityCensusPath, "utf8"));
    expect(buildIdentityCensus()).toEqual(stored);
    expect(stored.unexplained).toBe(0);
    expect(stored.entries.every((entry: { reason: string }) => Boolean(entry.reason))).toBe(true);
  });
});
