import { readJeffSecret } from "../_shared/identity-secrets.ts";
import { handlePrivateBetaRelay } from "../jeff-private-beta-ingress/relay.ts";
// Dedicated merchant webhook authentication; no invoice, payment or VIP authority here.
Deno.serve((request:Request)=>handlePrivateBetaRelay(request,{
 webhookSecret:readJeffSecret("JEFF_STARS_MERCHANT_WEBHOOK_SECRET"),
 relaySecret:readJeffSecret("JEFF_STARS_MERCHANT_RELAY_SECRET"),
 vercelBypass:readJeffSecret("JEFF_UAT_VERCEL_BYPASS"),
 commercial:{kind:"STARS",tenantId:readJeffSecret("JEFF_STARS_MERCHANT_TENANT_ID"),repositorySha:readJeffSecret("JEFF_STARS_MERCHANT_RELEASE_SHA")},
},fetch));
