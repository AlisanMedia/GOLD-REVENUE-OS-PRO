import { drainCustomerSuccess } from "@/lib/customer-success/worker";
import { drainSurveys } from "@/lib/surveys/worker";
import { drainAutomaticReplies } from "@/lib/messaging/automatic-replies";
import { timingSafeEqual } from "node:crypto";
import { runDeterministicWorker } from "@/lib/agent-runtime/worker";
import { drainEscalations } from "@/lib/escalations/service";
import { privateBetaIsolationActive } from "../../../../lib/polat/private-beta-isolation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const workload = new URL(request.url).searchParams.get("workload");
    let commerce: unknown = {state:"NOT_CONFIGURED"};
    if(process.env.POLAT_STARS_MERCHANT_TENANT_ID && (!workload||workload==="commerce")){
      const {runStarsCommerceMaintenance}=await import("@/lib/payments/telegram-stars-commerce");
      commerce=await runStarsCommerceMaintenance().catch(()=>({state:"BLOCKED_OR_REVIEW_REQUIRED"}));
    }
    if(workload==="commerce")return Response.json({status:"ok",commerce});
    if (workload === "campaign") {
      const { drainCampaignRecovery } = await import("@/lib/polat/campaign-execution");
      return Response.json({ status: "ok", campaign: await drainCampaignRecovery() });
    }
    if (privateBetaIsolationActive()) {
      if (workload) return Response.json({ error: "LEGACY_WORKLOAD_ISOLATED" }, { status: 423 });
      const { drainPrivateBetaRecovery } = await import("@/lib/polat/private-beta-runtime");
      const beta = await drainPrivateBetaRecovery();
      if (process.env.POLAT_CAMPAIGN_ID) {
        const { drainCampaignRecovery } = await import("@/lib/polat/campaign-execution");
        return Response.json({ status: "ok", ...(process.env.POLAT_STARS_MERCHANT_TENANT_ID?{commerce}:{}), private_beta: beta, campaign: await drainCampaignRecovery() });
      }
      return Response.json({ status: "ok", private_beta: beta,...(process.env.POLAT_STARS_MERCHANT_TENANT_ID?{commerce}:{}) });
    }
    if (workload && workload !== "customer-success" && workload !== "surveys") return Response.json({ error: "INVALID_WORKLOAD" }, { status: 400 });
    if (workload === "surveys") return Response.json({ status: "ok", surveys: await drainSurveys() });
    if (workload === "customer-success") return Response.json({ status: "ok", customer_success: await drainCustomerSuccess() });
    await drainEscalations();
    const { drainCampaignRecovery } = await import("@/lib/polat/campaign-execution");
    const campaign = await drainCampaignRecovery();
    const result = await runDeterministicWorker({
      deploymentRef: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    });
    await drainAutomaticReplies();
    return Response.json({ status: "ok", ...result, campaign, ...(process.env.POLAT_STARS_MERCHANT_TENANT_ID?{commerce}:{}), customer_success: await drainCustomerSuccess(), surveys: await drainSurveys() });
  } catch {
    return Response.json({ error: "WORKER_EXECUTION_FAILED" }, { status: 500 });
  }
}

