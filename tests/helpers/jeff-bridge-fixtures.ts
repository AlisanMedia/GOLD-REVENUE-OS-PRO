import { JEFF_CLAUDE_MODEL, jeffBridgeBindingSchema } from "../../packages/contracts/src/index";
import { jeffClaudeCanaryPlan } from "../../packages/domain/src/jeff-claude-canary";

/** Invented, source-grounded fixture. No genuine provider or customer material. */
export function jeffClaudeFixtureWire() {return {
  classification:"GREETING",semantic_response:{response_goal:"Respond to the greeting",key_points:["Hi!","I'm Jeff's AI assistant.","What would you like to know?"],factual_grounding:{classification:"unknown",evidence_refs:["EVIDENCE_COMMERCIAL_1"],missing_information:["approved_scoped_fact"]}},
  proposed_response:"Hi! I'm Jeff's AI assistant. What would you like to know?",confidence:0.7,escalation_recommended:false,escalation_category:null,
  claims:[{text:"Hi!",kind:"social",speech_act:"ACKNOWLEDGEMENT",capability:null,grounding:"GENERAL_SAFE_STATEMENT",evidence_refs:[],action_category:null},
    {text:"I'm Jeff's AI assistant.",kind:"fact",speech_act:"BUSINESS_FACT",capability:null,grounding:"KNOWN_FROM_SYSTEM",evidence_refs:["EVIDENCE_COMMERCIAL_1"],action_category:null},
    {text:"What would you like to know?",kind:"question",speech_act:"QUESTION",capability:null,grounding:"UNKNOWN",evidence_refs:[],action_category:null}],memory_proposals:[],proposed_tool_calls:[],
};}
/** Current customer greeting; legacy canary/accepted fixture output stays above. */
export function jeffSupportFixtureWire() {
  const output = jeffClaudeFixtureWire();
  output.proposed_response = "Hi! What would you like to know?";
  output.semantic_response.key_points = ["Hi!", "What would you like to know?"];
  output.semantic_response.factual_grounding.evidence_refs = [];
  output.claims = [output.claims[0]!, output.claims[2]!];
  return output;
}
export function jeffClaudeCompleteEnvelope(extra:Record<string,unknown>={}) {return {
  id:"msg_bridge_fixture_001",type:"message",role:"assistant",model:JEFF_CLAUDE_MODEL,
  container:null,diagnostics:{cache_miss_reason:{type:"messages_changed",cache_missed_input_tokens:10}},stop_details:null,stop_reason:"end_turn",stop_sequence:null,
  content:[{type:"text",text:JSON.stringify(jeffClaudeFixtureWire()),citations:[]}],
  usage:{input_tokens:37,output_tokens:121,cache_creation_input_tokens:0,cache_read_input_tokens:4,cache_creation:{ephemeral_1h_input_tokens:0,ephemeral_5m_input_tokens:0},output_tokens_details:{thinking_tokens:7},server_tool_use:{web_fetch_requests:0,web_search_requests:0},inference_geo:"global",service_tier:"standard",speed:"standard"},...extra,
};}
export function jeffBridgeFixtureBinding(extra:Record<string,unknown>={}) {
  const c=jeffClaudeCanaryPlan();
  return jeffBridgeBindingSchema.parse({version:1,mode:"OFFLINE_SYNTHETIC",provider:"anthropic",model:JEFF_CLAUDE_MODEL,model_version:JEFF_CLAUDE_MODEL,protocol_version:"2023-06-01",
    repository_sha:"a".repeat(40),corpus_version:c.plan.version,corpus_hash:c.corpus_hash,plan_hash:c.plan_hash,manifest_hash:"b".repeat(64),authorization_record_hash:"c".repeat(64),account_scope_hash:"d".repeat(64),profile_version:"jeff-ai-fixture-v2",
    maximum_requests:1,maximum_spend:"0.02",maximum_attempt_liability:"0.02",currency:"USD",maximum_output_tokens:512,timeout_ms:100,
    targets:[c.target_hash],expires_at:new Date(Date.now()+600000).toISOString(),financial_authority:"NONE",live_operations_authorized:false,authorized_external_requests:0,execution_enabled:false,...extra});
}
