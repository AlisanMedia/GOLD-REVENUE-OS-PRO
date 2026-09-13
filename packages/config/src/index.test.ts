import { describe, expect, it } from "vitest";
import { formatEnvError, parsePublicEnv, parseServerEnv } from "./index";

const valid = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key-with-safe-length",
};

describe("environment contract", () => {
  it("accepts the Phase 1 public configuration", () => {
    expect(parsePublicEnv(valid)).toEqual(valid);
  });

  it("defaults the server environment to development", () => {
    expect(parseServerEnv(valid).NODE_ENV).toBe("development");
  });

  it("rejects invalid URLs without exposing input values", () => {
    try {
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "secret-value" });
      throw new Error("expected validation to fail");
    } catch (error) {
      const output = formatEnvError(error).join(" ");
      expect(output).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(output).not.toContain("secret-value");
    }
  });
});
