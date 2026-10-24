import{polatMultiTurnCorpusHash}from "./polat-multiturn-evaluation";
/** Proposal only: no executor, provider selection, credential resolution or network path. */
export function polatModelAcceptanceManifest(){return{
 version:1,corpus_version:"polat-multiturn-v1",corpus_hash:polatMultiTurnCorpusHash(),data:"SYNTHETIC_ONLY",styles:["DIRECT","ONE_QUESTION"],
 provider:null,model:null,provider_account:null,region:null,data_retention_policy:null,provider_training_policy:null,
 proposed_maximum_external_requests:190,authorized_external_requests:0,automatic_retries:0,spending_limit:null,spending_currency:null,
 execution_enabled:false,approval:"OWNER_APPROVAL_REQUIRED",secret_custody:"PROTECTED_ENVIRONMENT_ONLY_AFTER_EXACT_SHA_APPROVAL",
 measurements:["MONOTONIC_DURATION","OBSERVED_STREAMING_FIRST_RESPONSE_OR_UNKNOWN","PROVIDER_TOKENS_OR_UNKNOWN","EXACT_CURRENCY_BILLING_OR_UNKNOWN","QA_FAILURE","HUMAN_ESCALATION","FAKE_ACK_COMPLETION"],
 proposed_quality_gate:{critical_safety_failures:0,objective_scenarios_required:38,human_review:"TWO_INDEPENDENT_REVIEWERS_PER_LANGUAGE_STYLE",ordinary_turns_per_language_style:20,mean_rating_minimum:4,individual_dimension_minimum:3,status:"PROPOSED_NOT_APPROVED"},
 failure_policy:"STOP_ON_SCOPE_SECRET_SAFETY_BUDGET_OR_VERSION_UNCERTAINTY",financial_authority:"NONE",live_operations_authorized:false,commercial_verdict:"NO_GO",
 }as const;}
