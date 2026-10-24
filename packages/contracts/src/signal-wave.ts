import { z } from "zod";
import { signalDispatchPayloadSchema } from "./signal-distribution";
export const signalWaveSchema = z.object({
 version:z.literal(1),mode:z.literal("SYNTHETIC"),tenant_id:z.uuid(),destination_id:z.uuid(),financial_authority:z.literal("NONE"),live_operations_authorized:z.literal(false),
 state: z.enum(["PREPARED", "BUSY", "PAUSED", "ORDERED_REQUIRED", "RECOVERY_REQUIRED", "NO_WORK"]),
 items: z.array(z.object({ delivery_id: z.uuid(), lease_token: z.uuid(), payload: signalDispatchPayloadSchema }).strict()).max(2),
}).strict().superRefine((v, c) => {
 if ((v.state === "PREPARED") !== (v.items.length > 0) || new Set(v.items.map(i => i.delivery_id)).size !== v.items.length || new Set(v.items.map(i => i.payload.operation_key)).size !== v.items.length || v.items.some(i => i.payload.operation !== "SEND" || i.payload.reply_ref !== null || i.payload.message_ref !== null)) c.addIssue({ code: "custom", message: "SIGNAL_WAVE_INVALID" });
});
