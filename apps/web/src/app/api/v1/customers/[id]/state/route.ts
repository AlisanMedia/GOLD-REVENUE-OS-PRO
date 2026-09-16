import { stateTransitionRequestSchema, stateTransitionResponseSchema } from "@gold-revenue-os/contracts";
import { apiError, requireCustomerTenant } from "@/lib/customer-os/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, tenantId } = await requireCustomerTenant(["super_admin", "manager"]);
    const input = stateTransitionRequestSchema.safeParse(await request.json());
    if (!input.success) {
      return Response.json({ error: { code: "INVALID_TRANSITION_REQUEST", message: "Transition request is invalid", issues: input.error.issues } }, { status: 400 });
    }
    const customerId = (await params).id;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("transition_customer_state", {
      target_tenant_id: tenantId,
      target_customer_id: customerId,
      expected_from_state: input.data.expected_from_state,
      target_to_state: input.data.to_state,
      reason_code_value: input.data.reason_code,
      actor_type_value: "HUMAN",
      actor_id_value: userId,
      correlation_id_value: input.data.correlation_id,
      causation_id_value: input.data.causation_id ?? null,
      triggering_event_value: input.data.triggering_event,
      triggering_event_id_value: input.data.triggering_event_id ?? null,
      idempotency_key_value: input.data.idempotency_key,
      occurred_at_value: input.data.occurred_at ?? new Date().toISOString(),
    });
    if (error) throw new Error("STATE_TRANSITION_FAILED");
    const result = stateTransitionResponseSchema.safeParse(data);
    if (!result.success) throw new Error("STATE_TRANSITION_RESPONSE_INVALID");
    return Response.json(result.data, { status: result.data.accepted ? 200 : 409 });
  } catch (error) {
    return apiError(error, "Unable to transition customer state");
  }
}
