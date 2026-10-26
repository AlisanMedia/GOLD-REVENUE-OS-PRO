import { handleStarsTestRelay } from "./relay.ts";
// Deploy --no-verify-jwt only for this exact function. Secret header + separate HMAC authenticate the fixed upstream.
Deno.serve((request: Request) => handleStarsTestRelay(request, {
  webhookSecret: Deno.env.get("POLAT_UAT_STARS_TEST_WEBHOOK_SECRET") ?? "",
  relaySecret: Deno.env.get("POLAT_UAT_STARS_RELAY_SECRET") ?? "",
  vercelBypass: Deno.env.get("POLAT_UAT_VERCEL_BYPASS") ?? "",
}, fetch));
