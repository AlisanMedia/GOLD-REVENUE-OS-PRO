import { readJeffSecret } from "../_shared/identity-secrets.ts";
import { handlePrivateBetaRelay } from "./relay.ts";

// Telegram cannot present a Supabase JWT. This one route uses the secret header,
// a separate HMAC relay secret, fixed upstream and SSO automation credential.
// Deploy --no-verify-jwt only for this exact function, never globally.
Deno.serve((request: Request) => handlePrivateBetaRelay(request, {
  webhookSecret: readJeffSecret("JEFF_UAT_TELEGRAM_WEBHOOK_SECRET"),
  relaySecret: readJeffSecret("JEFF_UAT_RELAY_SECRET"),
  vercelBypass: readJeffSecret("JEFF_UAT_VERCEL_BYPASS"),
}, fetch));
