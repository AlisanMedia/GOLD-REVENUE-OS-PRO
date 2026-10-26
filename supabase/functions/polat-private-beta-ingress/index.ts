import { handlePrivateBetaRelay } from "./relay.ts";

// Telegram cannot present a Supabase JWT. This one route uses the secret header,
// a separate HMAC relay secret, fixed upstream and SSO automation credential.
// Deploy --no-verify-jwt only for this exact function, never globally.
Deno.serve((request: Request) => handlePrivateBetaRelay(request, {
  webhookSecret: Deno.env.get("POLAT_UAT_TELEGRAM_WEBHOOK_SECRET") ?? "",
  relaySecret: Deno.env.get("POLAT_UAT_RELAY_SECRET") ?? "",
  vercelBypass: Deno.env.get("POLAT_UAT_VERCEL_BYPASS") ?? "",
}, fetch));
