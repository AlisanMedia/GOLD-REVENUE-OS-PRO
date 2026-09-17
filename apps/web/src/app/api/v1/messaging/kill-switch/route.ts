import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminCapability } from "@/lib/admin/permissions";
import { getUserContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ enabled: z.boolean(), correlation_id: z.uuid() }).strict();

export async function POST(request: Request) {
  const context = await getUserContext();
  if (!context) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const tenant = context.tenants[0];
  if (!tenant || !hasAdminCapability(tenant.role, "messaging.kill_switch")) {
    return NextResponse.json({ error: "KILL_SWITCH_MUTATION_DENIED" }, { status: 403 });
  }
  let input: z.infer<typeof schema>;
  try { input = schema.parse(await request.json()); }
  catch { return NextResponse.json({ error: "INVALID_KILL_SWITCH_REQUEST" }, { status: 400 }); }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_outbound_messaging_enabled", {
    target_tenant_id: tenant.id,
    enabled_value: input.enabled,
    correlation_id_value: input.correlation_id,
  });
  if (error) return NextResponse.json({ error: "KILL_SWITCH_UPDATE_FAILED" }, { status: 400 });
  return NextResponse.json({ outbound_messaging_enabled: data === true });
}
