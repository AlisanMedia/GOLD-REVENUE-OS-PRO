import { z } from "zod";
import { parseTelegramPrivateText, type TelegramUpdate } from "./messaging";
const numeric = z.string().regex(/^[1-9][0-9]{0,15}$/u).refine(s => Number.isSafeInteger(Number(s)));
const binding = z.strictObject({ version: z.literal(1), mode: z.enum(["BOT", "BUSINESS"]), tenant_id: z.uuid(), connection_id: z.uuid(),
  evidence_origin: z.literal("OFFLINE_FIXTURE"), bot_user_id: numeric, representative_user_id: numeric.nullable(), business_connection_id: z.string().min(1).max(160).nullable(),
  enabled: z.boolean(), can_reply: z.boolean(), observed_at: z.iso.datetime({ offset: true }), generation: z.string().regex(/^[1-9][0-9]{0,18}$/u),
});
/** Capability/normalization simulation for the existing gateway. No account login, authority or sender. */
export function assessTelegramOperationalUpdate(rawBinding: unknown, rawUpdate: unknown, expectedTenant: string, expectedGeneration: string, now: number) {
  const base = { mode: "OFFLINE_SYNTHETIC", outbound_authority: "NONE", financial_authority: "NONE", live_operations_authorized: false } as const;
  const hold = (reason: string) => ({ ...base, state: "HELD" as const, reason });
  try {
    const b = binding.parse(rawBinding);
    if (b.tenant_id !== expectedTenant || b.generation !== expectedGeneration || !Number.isFinite(now) || Date.parse(b.observed_at) > now || now - Date.parse(b.observed_at) > 60000 || !b.enabled) return hold("CONNECTION_UNVERIFIED_OR_STALE");
    if (!rawUpdate || typeof rawUpdate !== "object" || Array.isArray(rawUpdate)) return hold("UPDATE_INVALID");
    const u = rawUpdate as Record<string, unknown>;
    if (b.mode === "BOT") {
      if (u.business_message || u.edited_business_message || u.deleted_business_messages) return hold("BUSINESS_CONNECTION_NOT_SELECTED");
      if(u.message&&typeof u.message==="object"&&("business_connection_id"in u.message||"sender_business_bot"in u.message))return hold("BUSINESS_CONNECTION_NOT_SELECTED");
      const event = parseTelegramPrivateText(u as TelegramUpdate);
      if (event.providerUserId === b.bot_user_id) return hold("SELF_MESSAGE_NOT_INBOUND");
      return { ...base, state: "INBOUND_READY" as const, connection_id: b.connection_id, event };
    }
    if (!b.business_connection_id || !b.representative_user_id || !b.can_reply) return hold("BUSINESS_REPLY_PERMISSION_MISSING");
    const kind = u.business_message ? "business_message" : u.edited_business_message ? "edited_business_message" : u.deleted_business_messages ? "deleted_business_messages" : null;
    if (!kind) return hold("BUSINESS_UPDATE_REQUIRED");
    const raw = u[kind];if (!raw || typeof raw !== "object" || Array.isArray(raw)) return hold("UPDATE_INVALID");
    const m = raw as Record<string, unknown>;
    if (m.business_connection_id !== b.business_connection_id || !Number.isSafeInteger(u.update_id)) return hold("BUSINESS_CONNECTION_MISMATCH");
    if (kind === "deleted_business_messages") {
      const x = z.object({ business_connection_id: z.string(), chat: z.object({ id: z.number().int().safe(), type: z.literal("private") }), message_ids: z.array(z.number().int().positive().safe()).min(1).max(100) }).parse(m);
      return { ...base, state: "SOURCE_DELETION_REVIEW" as const, update_id: String(u.update_id), chat_id: String(x.chat.id), message_ids: x.message_ids.map(String), reason: "DELETION_IS_NOT_DELIVERY_REVOCATION" };
    }
    if (m.sender_business_bot) return hold("BOT_ECHO_NOT_HUMAN_TAKEOVER");
    const event = parseTelegramPrivateText({ update_id: u.update_id, message: m } as TelegramUpdate);
    if (event.providerUserId === b.representative_user_id) return { ...base, state: "HUMAN_REPLY_OBSERVED" as const, connection_id: b.connection_id, event, requires_ownership_commit: true };
    if (event.providerUserId === b.bot_user_id) return hold("SELF_MESSAGE_NOT_INBOUND");
    // Telegram Business permits replies only in an active, authorized private-chat window.
    const age = now - Date.parse(event.occurredAt);
    if (age < 0 || age >= 86400000) return hold("BUSINESS_CONTACT_WINDOW_UNVERIFIED");
    return { ...base, state: kind === "edited_business_message" ? "SOURCE_EDIT_REVIEW" as const : "INBOUND_READY" as const, connection_id: b.connection_id, event, requires_ownership_commit: kind === "edited_business_message" };
  } catch { return hold("UPDATE_OR_CAPABILITY_INVALID"); }
}
