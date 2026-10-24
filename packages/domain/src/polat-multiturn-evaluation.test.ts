import{beforeAll,describe,it,expect}from 'vitest';
import{writeFileSync}from 'node:fs';
import{evaluatePolatMultiTurn,polatMultiTurnCorpusHash}from './polat-multiturn-evaluation';
import{POLAT_MULTITURN_CORPUS}from './polat-multiturn-corpus';
let result:Awaited<ReturnType<typeof evaluatePolatMultiTurn>>;
beforeAll(async()=>{result=await evaluatePolatMultiTurn();if(process.env.POLAT_MULTITURN_EVIDENCE)writeFileSync(process.env.POLAT_MULTITURN_EVIDENCE,JSON.stringify(result,null,2)+'\n');},30000);
describe('versioned paired offline multi-turn acceptance',()=>{
 it('keeps the fixed golden corpus, all outcomes and heuristic/human evidence separation',()=>{
  expect(polatMultiTurnCorpusHash()).toBe('a932be94ff95369905a1a92552ce61d8395b6c6a2eb0a2e7c30dedb38e78c0c9');expect(result.corpus_hash).toBe(polatMultiTurnCorpusHash());expect(POLAT_MULTITURN_CORPUS).toHaveLength(38);
  expect(result.human_naturalness).toBe('NOT_MEASURED');expect(result.actual_model_cost).toBeNull();expect(result.input_tokens).toBeNull();
  for(const v of result.variants)for(const c of v.cases){expect(c.tracked_inbound).toBe(c.unique_inbound);expect(c.tracking_states.every(s=>(result.valid_tracking_states as readonly string[]).includes(s))).toBe(true);}
  expect(result.financial_authority).toBe('NONE');expect(result.live_operations_authorized).toBe(false);expect(result.commercial_verdict).toBe('NO_GO');
 });
 for(const style of ['DIRECT','ONE_QUESTION']as const)describe(style,()=>{
  it.each(POLAT_MULTITURN_CORPUS.map(c=>({id:c.id})))('$id',({id})=>{const c=result.variants.find(v=>v.style===style)!.cases.find(c=>c.id===id)!;expect(c.turns.filter(t=>!t.objective_pass)).toEqual([]);expect(c.objective_pass).toBe(true);});
 });
});
