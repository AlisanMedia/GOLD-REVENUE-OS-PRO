import "server-only";
import{polatRuntimeContextSchema,polatContactSnapshotSchema,type PolatRuntimeContext}from "@gold-revenue-os/contracts";
import { createHash } from "node:crypto";

import {
  CONTEXT_LIMITS,
  POLAT_PROFILE,
  preparePolatFixtureRuntime,
  preparePolatPrivateBetaRuntime,
  assertSafeContext,
  type BackendEvidence,
  messageEvidenceHandles,
  commercialEvidence,
  inferStyleProfile,
  type CommercialContext,
  type AgentContext,
  type ContextMessage,
} from "@gold-revenue-os/domain";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type TaskEnvelope = {
  tenant_id: string;
  customer_id: string | null;
  conversation_id: string;
  source_event_id: string;
};

type ConversationRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  runtime_mode: AgentContext["runtimeMode"];
  messaging_contacts: { contactability: string } | null;
};

export type ContextBuildResult = {
  polat?: PolatRuntimeContext;
  context: AgentContext;
  manifest: Record<string, unknown>;
};

export async function buildAgentContext(task: TaskEnvelope,options?:{polatTest?:true;polatClaudeOffline?:boolean;polatPrivateBeta?:Parameters<typeof preparePolatPrivateBetaRuntime>[2];polatPrivateBetaCodec?:"claude-messages-v1"|"openai-responses-v1"}): Promise<ContextBuildResult> {
  if(options?.polatPrivateBetaCodec&&!options.polatPrivateBeta)throw Error("POLAT_UAT_SCOPED_CODEC_REQUIRED");
  if(options?.polatPrivateBetaCodec&&!(["claude-messages-v1","openai-responses-v1"] as const).includes(options.polatPrivateBetaCodec))throw Error("POLAT_UAT_SCOPED_CODEC_REQUIRED");
  const supabase = createSupabaseAdminClient();
  const { data: conversationData, error: conversationError } = await supabase
    .from("conversations")
    .select("id,tenant_id,customer_id,runtime_mode,messaging_contacts(contactability)")
    .eq("tenant_id", task.tenant_id)
    .eq("id", task.conversation_id)
    .maybeSingle();
  if (conversationError || !conversationData) throw new Error("CONTEXT_CONVERSATION_NOT_FOUND");
  const conversation = conversationData as unknown as ConversationRow;
  if (conversation.tenant_id !== task.tenant_id || conversation.customer_id !== task.customer_id) {
    throw new Error("CONTEXT_TENANT_SCOPE_DENIED");
  }

  const { data: sourceEvent, error: sourceEventError } = await supabase
    .from("domain_events")
    .select("id,event_type,payload")
    .eq("tenant_id", task.tenant_id)
    .eq("id", task.source_event_id)
    .maybeSingle();
  const payload = sourceEvent?.payload as Record<string, unknown> | undefined;
  const sourceMessageId = typeof payload?.message_id === "string" ? payload.message_id : "";
  const sourceConversationId = typeof payload?.conversation_id === "string" ? payload.conversation_id : "";
  if (sourceEventError || !sourceEvent || sourceEvent.event_type !== "message.received"
    || sourceConversationId !== task.conversation_id
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceMessageId)) {
    throw new Error("CONTEXT_SOURCE_EVENT_INVALID");
  }
  const { data: sourceMessage, error: sourceMessageError } = await supabase
    .from("messages")
    .select("id,created_at")
    .eq("tenant_id", task.tenant_id)
    .eq("conversation_id", task.conversation_id)
    .eq("id", sourceMessageId)
    .maybeSingle();
  if (sourceMessageError || !sourceMessage) throw new Error("CONTEXT_SOURCE_MESSAGE_NOT_FOUND");

  let polat:PolatRuntimeContext|undefined;
  if(options?.polatTest){
    const contact=await supabase.rpc("polat_test_contact_for_source_v1",{target_tenant_id:task.tenant_id,target_conversation_id:task.conversation_id,target_event_id:task.source_event_id});
    if(contact.error)throw Error("POLAT_CONTACT_EVIDENCE_UNAVAILABLE");polatContactSnapshotSchema.parse(contact.data);
    const read=await supabase.rpc("polat_test_runtime_context_v1",{target_tenant_id:task.tenant_id,target_conversation_id:task.conversation_id,target_event_id:task.source_event_id});
    if(read.error)throw Error("POLAT_TEST_CONTEXT_UNAVAILABLE");polat=polatRuntimeContextSchema.parse(read.data);
    if(polat.input.tenant_id!==task.tenant_id||polat.input.conversation_id!==task.conversation_id||polat.input.customer_id!==task.customer_id||polat.input.source_message_id!==sourceMessageId)throw Error("POLAT_TEST_CONTEXT_SCOPE");
  }
  const sourceBoundary=polat?.input.boundary??sourceMessage.created_at;
  const [messagesResult, profileResult, memoryResult, eventsResult, customerResult] = await Promise.all([
    polat?Promise.resolve({data:[...polat.input.messages].reverse().map(m=>({...m,created_at:m.occurred_at})),error:null}):supabase.from("messages")
      .select("id,direction,content,occurred_at,created_at,status")
      .eq("tenant_id", task.tenant_id)
      .eq("conversation_id", task.conversation_id)
      .lte("created_at", sourceMessage.created_at)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CONTEXT_LIMITS.messages),
    !polat&&task.customer_id ? supabase.from("customer_profiles")
      .select("updated_at,experience_level,primary_instrument,trading_style,risk_preference,preferred_signal_frequency,communication_style,price_sensitivity,trust_level,pain_points,objections,next_best_action")
      .eq("tenant_id", task.tenant_id).eq("customer_id", task.customer_id)
      .lte("updated_at", sourceMessage.created_at).maybeSingle() : Promise.resolve({ data: null, error: null }),
    !polat&&task.customer_id ? supabase.from("customer_memory")
      .select("id,observed_at,memory_key,memory_value,confidence")
      .eq("tenant_id", task.tenant_id).eq("customer_id", task.customer_id)
      .is("superseded_at", null).lte("observed_at", sourceMessage.created_at).order("observed_at", { ascending: false })
      .limit(CONTEXT_LIMITS.memoryItems) : Promise.resolve({ data: [], error: null }),
    supabase.from("domain_events")
      .select("id,event_type,recorded_at")
      .eq("tenant_id", task.tenant_id)
      .eq("aggregate_id", task.conversation_id)
      .lte("recorded_at", sourceMessage.created_at)
      .order("recorded_at", { ascending: false })
      .limit(CONTEXT_LIMITS.recentEvents),
    task.customer_id ? supabase.from("customers")
      .select("state")
      .eq("tenant_id", task.tenant_id).eq("id", task.customer_id)
      .lte("updated_at", sourceMessage.created_at).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  if (messagesResult.error || profileResult.error || memoryResult.error || eventsResult.error || customerResult.error) {
    throw new Error("CONTEXT_QUERY_FAILED");
  }
  if (!polat&&!options?.polatPrivateBeta&&(messagesResult.data ?? []).some((row: { id: string; created_at: string }) => row.id !== sourceMessageId && row.created_at === sourceMessage.created_at)) {
    throw new Error("CONTEXT_TIMESTAMP_AMBIGUOUS");
  }

  let remainingCharacters = CONTEXT_LIMITS.totalMessageCharacters;
  const messages = ([...(messagesResult.data ?? [])] as Array<Record<string, unknown>>)
    .filter(row=>!options?.polatPrivateBeta||((row.direction==="inbound"||row.status==="sent")&&(Date.parse(String(row.created_at))<Date.parse(sourceMessage.created_at)||(Date.parse(String(row.created_at))===Date.parse(sourceMessage.created_at)&&String(row.id)<=sourceMessageId))))
    .flatMap((row): ContextMessage[] => {
      const raw = typeof row.content === "string" ? row.content : "";
      const content = raw.slice(0, Math.min(CONTEXT_LIMITS.messageCharacters, remainingCharacters));
      remainingCharacters -= content.length;
      if (!content) return [];
      return [{
        id: String(row.id),
        direction: row.direction === "outbound" ? "outbound" : "inbound",
        content,
        occurredAt: String(row.occurred_at),
      }];
    }).reverse();
  // Budget newest-first so long history cannot evict the triggering message.
  // Fail closed on timestamp ties or an omitted anchor rather than answering
  // a different inbound message.
  if (messages.at(-1)?.id !== sourceMessageId) {
    throw new Error("CONTEXT_SOURCE_MESSAGE_NOT_LAST");
  }

  const memory = polat?polat.input.memory.map(m=>({key:m.key,value:m.value,confidence:1})):(memoryResult.data ?? []).map((row: Record<string, unknown>) => ({
    key: String(row.memory_key),
    value: row.memory_value,
    confidence: typeof row.confidence === "number" ? row.confidence : row.confidence === null ? null : Number(row.confidence),
  }));
  const context: AgentContext = {
    tenantId: task.tenant_id,
    customerId: task.customer_id,
    conversationId: task.conversation_id,
    lifecycleState: customerResult.data && typeof customerResult.data.state === "string" ? customerResult.data.state : null,
    // Only the separately source-authorized beta profile uses the profile-level
    // normalized vocabulary. The persisted gateway contactability is unchanged.
    contactability: options?.polatPrivateBeta && ["user_initiated", "allowed"].includes(conversation.messaging_contacts?.contactability ?? "")
      ? "contactable" : conversation.messaging_contacts?.contactability ?? "unknown",
    runtimeMode: conversation.runtime_mode,
    profile: profileResult.data as Record<string, unknown> | null,
    memory,
    recentMessages: messages,
    recentEventTypes: [sourceEvent.event_type, ...(eventsResult.data ?? []).filter((row: { id: string }) => row.id !== sourceEvent.id).map((row: { event_type: string }) => row.event_type)],
  };
  const {data: commercialRaw,error:commercialError}=await supabase.rpc("phase9_commercial_context",{
    target_tenant_id:task.tenant_id,target_event_id:task.source_event_id,
  });
  if(commercialError)throw new Error("COMMERCIAL_CONTEXT_FAILED");
  const languagePreference=await supabase.rpc("customer_success_language_for_source",{target_tenant_id:task.tenant_id,target_event_id:task.source_event_id});
  if(languagePreference.error)throw new Error("CUSTOMER_LANGUAGE_EVIDENCE_UNAVAILABLE");
  if(typeof languagePreference.data==="string"&&["en","tr","ar","ru"].includes(languagePreference.data))context.verifiedCustomerLanguage=languagePreference.data;
  if(polat)polat.input.verified_customer_language=(["en","tr","ar","ru"].includes(context.verifiedCustomerLanguage??"")?context.verifiedCustomerLanguage:null) as PolatRuntimeContext["input"]["verified_customer_language"];
  const detectedLanguage=inferStyleProfile(messages,context.verifiedCustomerLanguage).language;
  const commercialLocale=(["en","tr","ar","ru"].includes(detectedLanguage)?detectedLanguage:"en") as "en"|"tr"|"ar"|"ru";
  if(commercialRaw){
    context.commercial=commercialRaw as CommercialContext;
    context.commercialEvidence=commercialEvidence(context.commercial,{tenantId:task.tenant_id,conversationId:task.conversation_id,boundary:sourceMessage.created_at,locale:commercialLocale});
  }
  const {data:conversionRaw,error:conversionError}=await supabase.rpc("phase9_conversion_for_source",{target_tenant_id:task.tenant_id,target_event_id:task.source_event_id});
  if(conversionError)throw new Error("CONVERSION_CONTEXT_FAILED");
  context.conversion=(conversionRaw??null) as NonNullable<AgentContext["conversion"]>|null;
  const selected=context.conversion?.result.plan_version_id;
  if(typeof selected==="string"&&context.commercial&&!context.commercial.conflict){
    context.commercial.documents=context.commercial.documents.filter(d=>d.kind!=="plan"||d.version_id===selected);
    context.commercialEvidence=commercialEvidence(context.commercial,{tenantId:task.tenant_id,conversationId:task.conversation_id,boundary:sourceMessage.created_at,locale:commercialLocale});
  }
  const receiptResult=await supabase.rpc("entitlement_conversation_receipts",{target_tenant_id:task.tenant_id,target_conversation_id:task.conversation_id,boundary_value:sourceMessage.created_at});
  if(receiptResult.error)throw new Error("ENTITLEMENT_EVIDENCE_UNAVAILABLE");
  const receipts=Array.isArray(receiptResult.data)?receiptResult.data as Array<{id:string;verified_at:string;ends_at:string;membership:string|null;membership_checked_at:string|null}>:[];
  const receiptEvidence:BackendEvidence[]=receipts.slice(0,3).flatMap(r=>{
    const scope={tenantId:task.tenant_id,conversationId:task.conversation_id,occurredAt:r.verified_at,status:"completed" as const};
    const payment={en:"Your payment has been verified.",tr:"Ödemeniz doğrulandı.",ar:"تم التحقق من الدفع.",ru:"Ваш платёж подтверждён."}[commercialLocale];
    const subscription={en:`Your membership is active until ${r.ends_at}.`,tr:`Üyeliğiniz ${r.ends_at} tarihine kadar aktif.`,ar:`عضويتك نشطة حتى ${r.ends_at}.`,ru:`Подписка активна до ${r.ends_at}.`}[commercialLocale];
    const items:BackendEvidence[]=[{...scope,id:r.id+":payment",category:"payment_confirmed",statement:payment},{...scope,id:r.id+":subscription",category:"subscription_updated",statement:subscription}];
    if(r.membership==="MEMBER"&&r.membership_checked_at&&Date.parse(r.membership_checked_at)<=Date.parse(sourceMessage.created_at))items.push({...scope,occurredAt:r.membership_checked_at,id:r.id+":access",category:"access_active",statement:{en:"Your VIP access is active.",tr:"VIP erişiminiz aktif.",ar:"وصولك إلى VIP نشط.",ru:"Доступ к VIP активен."}[commercialLocale]});
    return items;
  });
  context.commercialEvidence=[...(context.commercialEvidence??[]),...(polat||options?.polatPrivateBeta?[]:receiptEvidence)];
  const nativeProfile=polat&&options?.polatClaudeOffline?preparePolatFixtureRuntime(polat,context,"00000000-0000-4000-8000-000000000001","DIRECT",true):null;
  const betaProfile=options?.polatPrivateBeta?preparePolatPrivateBetaRuntime(context,"00000000-0000-4000-8000-000000000001",options.polatPrivateBeta):null;
  assertSafeContext(context);
  return {
    ...(polat?{polat}:{}),
    context,
    manifest: {
      ...(betaProfile?{polat_profile:"polat-private-beta-v1",private_beta_profile:"polat-private-beta-v1",private_beta_codec:options?.polatPrivateBetaCodec??"claude-messages-v1",private_beta_program_id:betaProfile.scope.program_id,private_beta_participant_id:betaProfile.scope.participant_id,private_beta_revision:String(betaProfile.scope.revision),private_beta_history_basis:"PROVIDER_ACK_ONLY",financial_authority:"NONE",commercial_sales:false}:{}),
      ...(polat?{polat_profile:polat.profile,polat_fixture_policy:POLAT_PROFILE.version,polat_generation:polat.generation,polat_observed_boundary:sourceBoundary,polat_history_basis:"MATCHED_FAKE_ACK_ONLY",polat_memory_sources:polat.input.memory.map(m=>m.source_message_id),polat_subscription_context:polat.subscription_context,financial_authority:"NONE",live_operations_authorized:false}:{}),
      context_version: 3,
      manifest_version: 2,
      retrieval_version: "source-bounded-v2",
      context_boundary_timestamp: sourceMessage.created_at,
      included_message_ids: messages.map((message) => message.id),
      included_event_ids: [sourceEvent.id, ...(eventsResult.data ?? []).filter((row: { id: string }) => row.id !== sourceEvent.id).map((row: { id: string }) => row.id)],
      included_memory_versions: (memoryResult.data ?? []).map((row: { id: string; observed_at: string }) => ({ id: row.id, observed_at: row.observed_at })),
      profile_version_timestamp: profileResult.data?.updated_at ?? null,
      message_fingerprints: messages.map((message) => ({ id: message.id,
        content_sha256: createHash("sha256").update(message.content).digest("hex"),
        included_characters: message.content.length,
        created_at: (messagesResult.data ?? []).find((row: { id: string }) => row.id === message.id)?.created_at,
      })),
      context_fingerprint: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
      mutable_state_retrieval: "exclude_versions_updated_after_source_boundary",
      backend_action_receipts: [],
      commercial_versions:context.commercial?.documents.map(d=>({item_id:d.item_id,version_id:d.version_id,version:d.version,kind:d.kind}))??[],
      commercial_locale:commercialLocale,
      commercial_conflict:context.commercial?.conflict??false,
      conversion_run_id:context.conversion?.run_id??null,
      commercial_fact_ids:context.commercialEvidence?.map(f=>f.id)??[],
      evidence_handle_registry: messageEvidenceHandles(betaProfile?.request.context??nativeProfile?.request.context??context),
      ...(nativeProfile?{polat_offline_codec:"claude-messages-v1"}:{}),
      source_event_id: task.source_event_id,
      source_message_id: sourceMessageId,
      source_message_created_at: sourceMessage.created_at,
      customer_included: task.customer_id !== null,
      profile_included: profileResult.data !== null,
      memory_count: memory.length,
      message_count: messages.length,
      event_count: context.recentEventTypes.length,
      message_character_count: messages.reduce((total, message) => total + message.content.length, 0),
      limits: CONTEXT_LIMITS,
      knowledge_sources: [
        "customer.core", "customer.profile", "customer.memory",
        "conversation.recent_messages", "conversation.contactability", "event.recent_types",
        ...(context.commercial?.documents.some(d=>d.kind==="plan")?["product.catalog","pricing.source_of_truth"]:[]),
        ...(context.commercial?.documents.some(d=>d.kind==="knowledge")?["knowledge_base"]:[]),
      ],
      unavailable_sources: [
        ...(profileResult.data === null ? ["customer.profile"] : []),
        ...(memory.length === 0 ? ["customer.memory"] : []),
        ...(context.commercial?.documents.some(d=>d.kind==="plan")?[]:["product.catalog","pricing.source_of_truth"]),
        ...(context.commercial?.documents.some(d=>d.kind==="knowledge")?[]:["knowledge_base"]),
        "payment.status", "subscription.status",
      ],
      secrets_included: false,
    },
  };
}
