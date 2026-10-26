import { z } from "zod";
import { getUserContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTelegramStarsUatFromDatabase } from "@/lib/payments/telegram-stars-uat-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (status: number, data: Record<string, unknown>) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply(403, { error: "ORIGIN_DENIED" });
  const context = await getUserContext(), selected = context?.tenants[0];
  if (!context) return reply(401, { error: "AUTH_REQUIRED" });
  if (!selected || selected.role !== "super_admin") return reply(403, { error: "OWNER_REQUIRED" });
  let input: { program_id: string; approved_offer_id: string; command_id: string };
  try {
    if (!/^application\/x-www-form-urlencoded(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) throw Error();
    const reader = request.body?.getReader(); if (!reader) throw Error(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 512) throw Error(); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if ([...form.keys()].length !== 3 || ["program_id", "approved_offer_id", "command_id"].some(k => form.getAll(k).length !== 1)) throw Error();
    input = z.strictObject({ program_id: z.uuid(), approved_offer_id: z.uuid(), command_id: z.uuid() }).parse(Object.fromEntries(form));
  } catch { return reply(400, { error: "INVALID_STARS_TEST_REQUEST" }); }
  try {
    const db = await createSupabaseServerClient();
    const auth = await db.rpc("admin_private_beta_stars_invoice_scope_v1", { target_tenant_id: selected.id, program_id_value: input.program_id, approved_offer_id_value: input.approved_offer_id, command_id_value: input.command_id });
    if (auth.error) throw Error();
    const scope = z.strictObject({ tenant_id: z.literal(selected.id), program_id: z.literal(input.program_id), approved_offer_id: z.literal(input.approved_offer_id), command_id: z.literal(input.command_id), repository_sha: z.string().regex(/^[a-f0-9]{40}$/u), already_created: z.boolean(), invoice_id: z.uuid().nullable() }).parse(auth.data);
    if (scope.already_created) return reply(200, { status: "EXISTING_TEST_INVOICE_REVIEW", invoice_id: scope.invoice_id, origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "NONE" });
    const connection = await createTelegramStarsUatFromDatabase({ tenantId: selected.id, programId: input.program_id, connectionRequestKey: "owner:" + input.command_id });
    if (connection.state !== "CONNECTED_TO_DEDICATED_TEST") throw Error();
    const invoice = await connection.createInvoice(input.approved_offer_id, input.command_id), result = await connection.sendInvoice(invoice, "invoice:" + input.command_id);
    if (result.state !== "ACKNOWLEDGED") throw Error();
    return reply(200, { status: "TEST_INVOICE_ACKNOWLEDGED", invoice_id: invoice.invoice_id, origin: "TELEGRAM_DEDICATED_TEST", financial_authority: "NONE", receipt_created: false });
  } catch { return reply(409, { error: "STARS_TEST_BLOCKED_OR_REVIEW_REQUIRED", retry: "NONE", financial_authority: "NONE" }); }
}
export function GET() { return reply(405, { error: "METHOD_NOT_ALLOWED" }); }
