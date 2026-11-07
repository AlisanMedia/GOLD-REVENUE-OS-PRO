import { readJeffSecret } from "../_shared/identity-secrets.ts";
import { handleStarsTestRelay } from "./relay.ts";
// Deploy --no-verify-jwt only for this exact function. Secret header + separate HMAC authenticate the fixed upstream.
Deno.serve((request: Request) => handleStarsTestRelay(request, {
  webhookSecret: readJeffSecret("JEFF_UAT_STARS_TEST_WEBHOOK_SECRET"),
  relaySecret: readJeffSecret("JEFF_UAT_STARS_RELAY_SECRET"),
  vercelBypass: readJeffSecret("JEFF_UAT_VERCEL_BYPASS"),
}, fetch));
