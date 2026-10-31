import { handlePrivateBetaRelay } from "../polat-private-beta-ingress/relay.ts";
// Dedicated merchant webhook authentication; no invoice, payment or VIP authority here.
Deno.serve((request:Request)=>handlePrivateBetaRelay(request,{
 webhookSecret:Deno.env.get("POLAT_STARS_MERCHANT_WEBHOOK_SECRET")??"",
 relaySecret:Deno.env.get("POLAT_STARS_MERCHANT_RELAY_SECRET")??"",
 vercelBypass:Deno.env.get("POLAT_UAT_VERCEL_BYPASS")??"",
 commercial:{kind:"STARS",tenantId:Deno.env.get("POLAT_STARS_MERCHANT_TENANT_ID")??"",repositorySha:Deno.env.get("POLAT_STARS_MERCHANT_RELEASE_SHA")??""},
},fetch));
