import { handlePrivateBetaRelay } from "../polat-private-beta-ingress/relay.ts";
// One reviewed fixed-path relay only. Keep Admin and other functions protected.
Deno.serve((request:Request)=>handlePrivateBetaRelay(request,{
 webhookSecret:Deno.env.get("POLAT_CAMPAIGN_WEBHOOK_SECRET")??"",
 relaySecret:Deno.env.get("POLAT_CAMPAIGN_RELAY_SECRET")??"",
 vercelBypass:Deno.env.get("POLAT_UAT_VERCEL_BYPASS")??"",
 commercial:{kind:"CAMPAIGN",tenantId:Deno.env.get("POLAT_CAMPAIGN_TENANT_ID")??"",campaignId:Deno.env.get("POLAT_CAMPAIGN_ID")??"",repositorySha:Deno.env.get("POLAT_CAMPAIGN_RELEASE_SHA")??""},
},fetch));
