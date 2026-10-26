import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserContext } from "@/lib/auth/context";
import { runPrivateBetaCanaryForOwner } from "@/lib/polat/private-beta-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const response = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return response({ error: "ORIGIN_DENIED" }, 403);
  const context = await getUserContext(), selected = context?.tenants[0];
  if (!context) return response({ error: "AUTH_REQUIRED" }, 401);
  if (!selected || selected.role !== "super_admin") return response({ error: "OWNER_REQUIRED" }, 403);
  let program: string;
  try {
    if (!request.body || !/^application\/x-www-form-urlencoded(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) throw Error("invalid");
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 512) throw Error("bound"); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const raw = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    const form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if ([...form.keys()].length !== 1 || form.getAll("program_id").length !== 1) throw Error("invalid");
    program = z.uuid().parse(form.get("program_id"));
  } catch { return response({ error: "INVALID_CANARY_REQUEST" }, 400); }
  try { return response(await runPrivateBetaCanaryForOwner({ tenantId: selected.id, programId: program }), 200); }
  catch { return response({ error: "CANARY_BLOCKED_OR_REVIEW_REQUIRED", retry: "NONE", financial_authority: "NONE" }, 409); }
}
