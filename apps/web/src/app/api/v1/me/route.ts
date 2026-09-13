import { meResponseSchema } from "@gold-revenue-os/contracts";
import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const context = await getUserContext();
  if (!context) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required", request_id: requestId } }, { status: 401 });
  }
  const payload = meResponseSchema.parse({
    user: { id: context.user.id, email: context.user.email ?? null },
    tenants: context.tenants,
  });
  return NextResponse.json(payload, { headers: { "cache-control": "private, no-store", "x-request-id": requestId } });
}
