import { formatEnvError } from "@gold-revenue-os/config";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = serverEnv();
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("identity dependency unavailable");
    return NextResponse.json({ status: "ready" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { status: "not_ready", reasons: formatEnvError(error) },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
