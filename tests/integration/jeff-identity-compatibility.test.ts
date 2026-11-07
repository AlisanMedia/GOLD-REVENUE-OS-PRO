import { afterEach, describe, expect, it, vi } from "vitest";
import { jeffTransportHeaders } from "../../apps/web/src/lib/jeff/transport-headers";
import { IDENTITY_NAMES_V1 } from "../../packages/contracts/src/historical/identity-names-v1";
import { currentIdentityTag } from "../../packages/contracts/src/historical/identity-wire-v1";
import { assessJeffSupportIdentity } from "../../packages/domain/src/jeff-support-identity";
import { readJeffSecret } from "../../supabase/functions/_shared/identity-secrets";

afterEach(() => vi.unstubAllGlobals());
describe("identity cutover compatibility, without new authority", () => {
  it.each(["uat", "stars"] as const)("accepts complete signed %s namespaces and rejects mixed namespaces", kind => {
    const suffix = kind === "uat" ? "uat" : "stars-uat";
    const legacy = kind === "uat" ? [IDENTITY_NAMES_V1.uatTimestamp, IDENTITY_NAMES_V1.uatSignature] : [IDENTITY_NAMES_V1.starsTimestamp, IDENTITY_NAMES_V1.starsSignature];
    const current = [`x-jeff-${suffix}-timestamp`, `x-jeff-${suffix}-signature`];
    for (const pair of [current, legacy]) expect(jeffTransportHeaders(new Headers({ [pair[0]!]: "123", [pair[1]!]: "proof" }), kind)).toEqual({ timestamp: "123", signature: "proof" });
    for (const pair of [[current[0]!, legacy[1]!], [legacy[0]!, current[1]!]]) expect(() => jeffTransportHeaders(new Headers({ [pair[0]!]: "123", [pair[1]!]: "proof" }), kind)).toThrow("JEFF_TRANSPORT_NAMESPACE_CONFLICT");
  });
  it("reads sealed secrets through the temporary alias and fails on conflicts", () => {
    const oldKey = IDENTITY_NAMES_V1.environmentPrefix + "_UAT_RELAY_SECRET";
    const entries: Record<string, string> = { [oldKey]: "synthetic-local-secret" };
    vi.stubGlobal("Deno", { env: { get: (key: string) => entries[key] } });
    expect(readJeffSecret("JEFF_UAT_RELAY_SECRET")).toBe(entries[oldKey]);
    entries.JEFF_UAT_RELAY_SECRET = "synthetic-local-secret";
    expect(readJeffSecret("JEFF_UAT_RELAY_SECRET")).toBe(entries.JEFF_UAT_RELAY_SECRET);
    entries.JEFF_UAT_RELAY_SECRET = "different-fixture";
    expect(() => readJeffSecret("JEFF_UAT_RELAY_SECRET")).toThrow("JEFF_SECRET_ALIAS_CONFLICT");
    expect(() => readJeffSecret("UNSCOPED_SECRET")).toThrow("JEFF_SECRET_NAME_REQUIRED");
  });
  it("presents old version tags as Jeff without mutating the stored value", () => {
    const record = { model: IDENTITY_NAMES_V1.display.toLowerCase() + "-test-runtime-v1" };
    expect(currentIdentityTag(record.model)).toBe("jeff-test-runtime-v1");
    expect(record.model).toBe(IDENTITY_NAMES_V1.display.toLowerCase() + "-test-runtime-v1");
    expect(currentIdentityTag("gpt-6.1-sol")).toBe("gpt-6.1-sol");
  });
  it("holds an obsolete self-introduction but preserves unrelated names in customer text", () => {
    const previous = IDENTITY_NAMES_V1.display;
    for (const text of [`I'm ${previous}.`, `${previous} VIP support.`, `I'm ${previous}'s AI assistant.`]) expect(assessJeffSupportIdentity(text, false)).toContain("JEFF_LEGACY_IDENTITY_FORBIDDEN");
    expect(assessJeffSupportIdentity(`Thanks, ${previous}. What would you like to know?`, false)).toEqual([]);
    expect(assessJeffSupportIdentity("Jeff VIP support.", false)).toEqual([]);
  });
});
