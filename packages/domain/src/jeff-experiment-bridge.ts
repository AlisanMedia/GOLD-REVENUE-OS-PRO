import { randomUUID, createHash } from "node:crypto";
import { jeffBridgeBindingSchema, type JeffBridgeOutcome } from "@gold-revenue-os/contracts";
import { createJeffClaudeOfflineProvider, prepareJeffClaudeRequest, JeffClaudeFailure } from "./jeff-claude-adapter";
import { assessJeffDraft, JEFF_PROFILE, type PreparedJeffConversation } from "./jeff-conversation";
import { jeffOfflineClaudeMeasurement } from "./jeff-model-evaluation";
import { jeffGuardDigest } from "./jeff-experiment-journal";
import { jeffClaudeCanaryPlan } from "./jeff-claude-canary";
import { jeffGenuineExecutionGate } from "./jeff-experiment-execution-gate";
import { type JeffExperimentFixtureStore } from "./jeff-experiment-store";
import { ModelProviderError, type ModelResponse } from "./agent-runtime";

export { createJeffExperimentPgFixtureStore } from "./jeff-experiment-store";
export { jeffClaudeCanaryPlan } from "./jeff-claude-canary";
export { jeffGenuineExecutionGate } from "./jeff-experiment-execution-gate";
export { sendJeffClaudeHttpsOnce } from "./jeff-claude-https-boundary";
export { createJeffProviderControlPlane, jeffAccountControlSigningBytes, jeffAccountControlEvidenceSchema } from "./jeff-provider-control";

/** Offline integration of the accepted codec/QA with the durable journal backend. No alternate approval engine. */
export async function openJeffDurableOfflineCanary(args:{store:JeffExperimentFixtureStore;run_id:string;binding:unknown}) {
  const binding=jeffBridgeBindingSchema.parse(args.binding), canary=jeffClaudeCanaryPlan();
  if(binding.profile_version!==JEFF_PROFILE.version||binding.corpus_version!==canary.plan.version||binding.corpus_hash!==canary.corpus_hash||binding.plan_hash!==canary.plan_hash||binding.maximum_requests!==1||binding.targets.length!==1||binding.targets[0]!==canary.target_hash||binding.maximum_output_tokens>canary.plan.proposed_maximum_output_tokens||binding.timeout_ms>canary.plan.proposed_timeout_ms)throw Error("JEFF_BRIDGE_CANARY_BINDING_DENIED");
  const preparedRun=await args.store.prepare(args.run_id,binding), runId=preparedRun.run_id, bindingHash=preparedRun.binding_hash;
  return Object.freeze({
    state:jeffGenuineExecutionGate(),run_id:runId,binding_hash:bindingHash,
    read:()=>args.store.read(runId),
    async attempt(prepared:PreparedJeffConversation,frame:unknown,signal?:AbortSignal){
      if(prepared.input.tenant_id!==args.store.tenant_id||prepared.input.messages.length!==1||prepared.input.messages[0]?.content!==canary.plan.cases[0].text||prepared.request.styleProfile?.language!==canary.plan.cases[0].language)throw Error("JEFF_BRIDGE_CANARY_INPUT_DENIED");
      const request={...prepared.request,timeoutMs:binding.timeout_ms},wire=prepareJeffClaudeRequest(request,binding.maximum_output_tokens);
      const provider=createJeffClaudeOfflineProvider({adapter_version:"jeff-claude-messages-v1",model:binding.model,maximum_output_tokens:binding.maximum_output_tokens,timeout_ms:Math.min(binding.timeout_ms,1000),frame});
      const reservation=await args.store.reserve(runId,randomUUID(),canary.target_hash,wire.request_hash,wire.body_hash,bindingHash);
      if(reservation.replay||reservation.dispatch_started)return {state:"ALREADY_RESERVED_REVIEW_REQUIRED",attempt_id:reservation.attempt_id,network_calls:0,financial_authority:"NONE",live_operations_authorized:false};
      const key=randomUUID(),started=await args.store.begin(runId,reservation.attempt_id,bindingHash,key,randomUUID());
      if(!started.dispatch)return {state:started.state,attempt_id:reservation.attempt_id,network_calls:0,financial_authority:"NONE",live_operations_authorized:false};
      let response:ModelResponse|null=null,failure:ModelProviderError|null=null;
      const start=performance.now();
      try{response=await provider.provider.invoke(request,signal);}catch(error){failure=error instanceof ModelProviderError?error:new ModelProviderError("PROVIDER_ERROR","JEFF_BRIDGE_REDACTED_FAILURE",false);}
      const elapsed=performance.now()-start,quality=response?assessJeffDraft(prepared,response.output):null;
      const unknown=failure instanceof JeffClaudeFailure&&failure.outcome_unknown||!Number.isFinite(elapsed)||elapsed<0;
      const observation=jeffOfflineClaudeMeasurement({tenantId:prepared.input.tenant_id,conversationId:prepared.input.conversation_id,invocationId:reservation.attempt_id,promptVersion:request.versions!.prompt,personaVersion:JEFF_PROFILE.version},Math.max(0,Number.isFinite(elapsed)?elapsed:0),response,failure,provider.evidence());
      const outcome:JeffBridgeOutcome={version:1,evidence_id:randomUUID(),stage:unknown?"RESULT_UNKNOWN":"PROVIDER_RESULT",status:unknown?"UNKNOWN":response?"SUCCEEDED":"FAILED",
        response_hash:unknown?null:provider.evidence().response_hash,response_identity_hash:unknown||!response?.providerRequestId?null:createHash("sha256").update(JSON.stringify([response.provider,response.providerRequestId]),"utf8").digest("hex"),
        elapsed_ms:Number.isFinite(elapsed)&&elapsed>=0?elapsed.toFixed(6):null,input_tokens:unknown?null:response?.usage.inputTokens??null,output_tokens:unknown?null:response?.usage.outputTokens??null,
        qa:unknown?"NOT_EVALUATED":quality?.action==="SAFE_PREVIEW"?"APPROVED":quality?"HELD":"NOT_EVALUATED",reconciliation_hash:null,simulated_billed_amount:null,currency:binding.currency,actual_billed_amount:null,actual_billed_currency:null,financial_authority:"NONE",live_operations_authorized:false};
      let recorded;
      try{recorded=await args.store.record(runId,reservation.attempt_id,bindingHash,key,outcome);}catch{return {state:"EVIDENCE_COMMIT_UNKNOWN_REVIEW_REQUIRED",attempt_id:reservation.attempt_id,network_calls:0,fake_transport_calls:provider.evidence().calls,financial_authority:"NONE",live_operations_authorized:false};}
      return {state:unknown?"UNKNOWN_REVIEW_REQUIRED":quality?.action==="SAFE_PREVIEW"?"RECORDED_BILLING_UNVERIFIED":"RECORDED_REVIEW_REQUIRED",attempt_id:reservation.attempt_id,recorded,observation,qa:quality,outcome_hash:jeffGuardDigest(outcome),network_calls:0,fake_transport_calls:provider.evidence().calls,financial_authority:"NONE",live_operations_authorized:false};
    },
  });
}
