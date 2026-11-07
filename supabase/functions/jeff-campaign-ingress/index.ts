import { readJeffSecret } from "../_shared/identity-secrets.ts";
import { handlePrivateBetaRelay } from "../jeff-private-beta-ingress/relay.ts";
// One reviewed fixed-path relay only. Keep Admin and other functions protected.
Deno.serve((request:Request)=>handlePrivateBetaRelay(request,{
 webhookSecret:readJeffSecret("JEFF_CAMPAIGN_WEBHOOK_SECRET"),
 relaySecret:readJeffSecret("JEFF_CAMPAIGN_RELAY_SECRET"),
 vercelBypass:readJeffSecret("JEFF_UAT_VERCEL_BYPASS"),
 commercial:{kind:"CAMPAIGN",tenantId:readJeffSecret("JEFF_CAMPAIGN_TENANT_ID"),campaignId:readJeffSecret("JEFF_CAMPAIGN_ID"),repositorySha:readJeffSecret("JEFF_CAMPAIGN_RELEASE_SHA")},
},fetch));
