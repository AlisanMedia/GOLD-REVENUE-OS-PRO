import { NextResponse } from "next/server";
import { z } from "zod";
import { recoverOwnUnfinishedMfa } from "@/lib/auth/mfa-enrollment-recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** No GET mutation, no user/tenant/approval override and no Auth admin deletion. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "RECOVERY_BLOCKED" }, 403);
  let input: { factor_id: string; confirmed: true };
  try {
    if (!request.body || !/^application\/x-www-form-urlencoded(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) throw Error("BODY");
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 512) throw Error("BOUND"); chunks.push(p.value); } }
    finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
    if ([...form.keys()].length !== 2 || form.getAll("factor_id").length !== 1 || form.getAll("confirmed").length !== 1 || form.get("confirmed") !== "yes") throw Error("BODY");
    input = z.strictObject({ factor_id: z.uuid(), confirmed: z.literal(true) }).parse({ factor_id: form.get("factor_id"), confirmed: true });
  } catch { return reply({ error: "RECOVERY_BLOCKED" }, 400); }
  try {
    const result = await recoverOwnUnfinishedMfa({ factorId: input.factor_id, confirmed: input.confirmed });
    return result.status === 200 ? reply(result.data, 200) : reply({ error: result.error, retry: "NONE" }, result.status);
  } catch { return reply({ error: "UNAVAILABLE", retry: "NONE" }, 503); }
}
