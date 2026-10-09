import { drainAutomaticReplies } from "@/lib/messaging/automatic-replies";
import { timingSafeEqual } from "node:crypto";
import { runDeterministicWorker } from "@/lib/agent-runtime/worker";

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
    const result = await runDeterministicWorker({
      deploymentRef: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    });
    await drainAutomaticReplies();
    return Response.json({ status: "ok", ...result });
  } catch {
    return Response.json({ error: "WORKER_EXECUTION_FAILED" }, { status: 500 });
  }
}

