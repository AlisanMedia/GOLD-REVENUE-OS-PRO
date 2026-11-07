import { IDENTITY_NAMES_V1 } from "../../../packages/contracts/src/historical/identity-names-v1.ts";

/** Temporary only while the protected operator copies unreadable stored secrets.
 * New configuration always uses JEFF_*; conflicting aliases fail closed. */
export function readJeffSecret(name: string): string {
  if (!name.startsWith("JEFF_")) throw Error("JEFF_SECRET_NAME_REQUIRED");
  const current = Deno.env.get(name) ?? "";
  const previous = Deno.env.get(IDENTITY_NAMES_V1.environmentPrefix + name.slice(4)) ?? "";
  if (current && previous && current !== previous) throw Error("JEFF_SECRET_ALIAS_CONFLICT");
  return current || previous;
}
