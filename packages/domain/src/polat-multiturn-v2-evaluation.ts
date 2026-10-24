import{evaluatePolatMultiTurn}from "./polat-multiturn-evaluation";
import{POLAT_MULTITURN_V2_CORPUS,POLAT_V2_VERSION,polatV2CorpusPlan,polatReplyLanguageEvidence,polatOrdinaryTurnKey}from "./polat-multiturn-v2-corpus";
export async function evaluatePolatMultiTurnV2(){
 const plan=polatV2CorpusPlan(),run=await evaluatePolatMultiTurn({version:POLAT_V2_VERSION,hash:plan.hash,scenarios:POLAT_MULTITURN_V2_CORPUS});
 const variants=run.variants.map(v=>{const ordinary={en:new Set<string>(),tr:new Set<string>()};const cases=v.cases.map(c=>{const scenario=POLAT_MULTITURN_V2_CORPUS.find(s=>s.id===c.id)!;
  const turns=c.turns.map(t=>{const meta=scenario.turns[t.index]!,language=polatReplyLanguageEvidence(t.reply_preview,meta.expected_reply_language);
   const eligible=meta.review_class==="ORDINARY"&&t.objective_pass&&t.quality_action==="SAFE_PREVIEW"&&language.state==="MATCH";
   if(eligible)ordinary[meta.expected_reply_language].add(polatOrdinaryTurnKey(meta.text,meta.expected_reply_language));
   const failures=[...t.failures,...(t.reply_preview!==null&&language.state!=="MATCH"?["EXPECTED_REPLY_LANGUAGE_NOT_SUPPORTED_BY_OUTPUT"]:[]),...(meta.review_class==="ORDINARY"&&!eligible?["ORDINARY_REVIEW_OR_LANGUAGE_NOT_QUALIFIED"]:[])];
   return{...t,review_class:meta.review_class,expected_reply_language:meta.expected_reply_language,language_evidence:language,ordinary_review_eligible:eligible,ordinary_distinct_key:polatOrdinaryTurnKey(meta.text,meta.expected_reply_language),failures,objective_pass:failures.length===0};
  });return{...c,turns,objective_pass:turns.every(t=>t.objective_pass)};
 });return{...v,cases,objective_passed:cases.filter(c=>c.objective_pass).length,qualifying_ordinary:{en:ordinary.en.size,tr:ordinary.tr.size}};});
 return{...run,variants,plan,coverage_complete:variants.every(v=>v.qualifying_ordinary.en>=20&&v.qualifying_ordinary.tr>=20),human_review_state:"HUMAN_REVIEW_PENDING",naturalness:"NATURALNESS_NOT_MEASURED",real_model:"REAL_MODEL_NOT_TESTED",customer_conversion:"CUSTOMER_CONVERSION_UNKNOWN"}as const;
}
