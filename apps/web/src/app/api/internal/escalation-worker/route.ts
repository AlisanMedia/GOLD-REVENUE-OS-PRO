import { createHash, timingSafeEqual } from "node:crypto";
import { drainEscalations } from "@/lib/escalations/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqual(createHash("sha256").update(request.headers.get("authorization") ?? "").digest(), createHash("sha256").update(`Bearer ${secret}`).digest())) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try { await drainEscalations(); return Response.json({ status: "ok", scope: "isolated-escalations", payment_effects: false, access_effects: false }); }
  catch { return Response.json({ error: "ESCALATION_WORKER_FAILED" }, { status: 503 }); }
}
