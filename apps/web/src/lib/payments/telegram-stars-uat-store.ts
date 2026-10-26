import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { connectTelegramStarsUat, type StarsUatAttemptCustody } from "./telegram-stars-uat";
import { telegramStarsUatInvoiceSchema, type StarsUatHistory } from "../../../../../packages/domain/src/telegram-stars-uat";

/** Narrow server-owned TEST custody; never selected by general payment factories, workers or a browser activation flag. */
export async function createTelegramStarsUatFromDatabase(input: { tenantId: string; programId: string; connectionRequestKey: string }, transport: typeof fetch = fetch) {
  const scope = z.strictObject({ tenantId: z.uuid(), programId: z.uuid(), connectionRequestKey: z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/u) }).parse(input);
  const release = process.env.POLAT_UAT_RELEASE_SHA;
  if (!release || !/^[a-f0-9]{40}$/u.test(release) || process.env.VERCEL_GIT_COMMIT_SHA !== undefined && process.env.VERCEL_GIT_COMMIT_SHA !== release) throw Error("STARS_TEST_RELEASE_UNAVAILABLE");
  const db = createSupabaseAdminClient(), nonces = new Map<string, string>();
  const rpc = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const result = await db.rpc(name, { target_tenant_id: scope.tenantId, program_id_value: scope.programId, ...args });
    if (result.error) throw Error("STARS_TEST_SERVER_STORE_UNAVAILABLE"); return result.data as unknown;
  };
  const custody: StarsUatAttemptCustody = {
    async reserve(value) {
      if (value.program_id !== scope.programId || value.tenant_id !== scope.tenantId) throw Error("STARS_TEST_SCOPE_DENIED");
      const nonce = randomUUID(), result = z.strictObject({ attempt_id: z.uuid(), dispatch: z.boolean() }).parse(await rpc("private_beta_stars_reserve_v1", {
        binding_revision_value: value.binding_revision, operation_value: value.operation, request_key_value: value.request_key, effect_key_value: value.effect_key, request_hash_value: value.request_hash, dispatch_nonce_value: nonce,
      }));
      if (result.dispatch) nonces.set(result.attempt_id, nonce); return result;
    },
    async record(value) {
      const nonce = nonces.get(value.attempt_id); if (!nonce) throw Error("STARS_TEST_OWNED_DISPATCH_REQUIRED");
      z.object({ recorded: z.literal(true) }).parse(await rpc("private_beta_stars_record_attempt_v1", { attempt_id_value: value.attempt_id, dispatch_nonce_value: nonce, raw_outcome_value: JSON.stringify(value) }));
    },
  };
  const connection = await connectTelegramStarsUat({
    async readAuthenticatedBinding() {
      const value = z.object({ release_sha: z.literal(release), tenant_id: z.literal(scope.tenantId), program_id: z.literal(scope.programId) }).passthrough().parse(await rpc("private_beta_stars_binding_v1"));
      return value;
    },
    readProtectedCredential() {
      // Reached only after protected postgres account-control and owner/tenant/window verification. No fallback to the main Telegram bot.
      const token = process.env.POLAT_UAT_STARS_TEST_BOT_TOKEN, secret = process.env.POLAT_UAT_STARS_TEST_WEBHOOK_SECRET;
      return token && secret ? Promise.resolve({ bot_token: token, webhook_secret: secret }) : Promise.reject(Error("STARS_TEST_CREDENTIALS_UNAVAILABLE"));
    },
    custody, transport,
    async readTestHistory(invoiceId) { return z.array(z.object({ tenant_id: z.uuid(), invoice_id: z.uuid(), operation_key: z.string(), delivery_key: z.string(), raw_hash: z.string(), fact_hash: z.string(), kind: z.enum(["PAYMENT", "REFUND"]), amount_units: z.string() }).strict()).max(100).parse(await rpc("private_beta_stars_history_v1", { target_invoice_id: invoiceId })) as readonly StarsUatHistory[]; },
    recordTestEvidence: value => rpc("private_beta_stars_record_evidence_v1", { target_invoice_id: value.invoice_id, ledger_attempt_id_value: value.ledger_attempt_id, raw_evidence_value: JSON.stringify({ event: value.event, ledger: value.ledger }) }),
    claimTestAccess: () => rpc("private_beta_stars_access_claim_v1"),
    recordTestAccess: value => rpc("private_beta_stars_access_complete_v1", { job_id_value: value.job_id, lease_token_value: value.lease_token, raw_outcome_value: JSON.stringify(value.outcome) }),
    recordTestJoinRequest: value => rpc("private_beta_stars_join_request_v1", { user_id_value: value.user_id, channel_id_value: value.channel_id, invite_hash_value: value.invite_hash, source_hash_value: value.source_hash, source_time_value: value.source_time }),
  }, scope.connectionRequestKey);
  if (connection.state !== "CONNECTED_TO_DEDICATED_TEST") return connection;
  return { ...connection,
    async createInvoice(approvedOfferId: string, requestKey: string) {
      const offer = z.uuid().parse(approvedOfferId), key = z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/u).parse(requestKey);
      return telegramStarsUatInvoiceSchema.parse(await rpc("private_beta_stars_invoice_v1", { target_offer_id: offer, request_key_value: key }));
    },
    async prepareTestAccess(invoiceId: string) { return z.strictObject({ access_id: z.uuid(), mode: z.literal("test"), origin: z.literal("TELEGRAM_DEDICATED_TEST"), financial_authority: z.literal("NONE") }).parse(await rpc("private_beta_stars_bind_access_v1", { target_invoice_id: z.uuid().parse(invoiceId) })); },
  };
}
