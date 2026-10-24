import{describe,it,expect}from "vitest";
import{preparePolatConversation,PolatFixtureProvider,assessPolatDraft,buildLeadIntelligence,buildConversion}from "../../packages/domain/src/index";
import{polatFixture}from "../../packages/domain/src/polat-conversation.fixtures";

describe("Polat fixture through accepted lead, conversion, provider and QA interfaces",()=>{
 it.each(["en","tr"]as const)("answers the current scoped %s question without a sending or financial service",async lang=>{
  const p=preparePolatConversation(polatFixture(lang==="en"?"What is the monthly membership price?":"Aylık üyelik fiyatı nedir?",lang));
  const context=p.request.context;
  const lead=buildLeadIntelligence({messages:context.recentMessages,customerId:context.customerId,conversationId:context.conversationId,sourceId:p.input.source_message_id,observedAt:p.input.boundary,runtimeMode:context.runtimeMode,lifecycleState:null,contactability:context.contactability,outboundEnabled:false});
  const conversion=buildConversion(context,{documents:[],conflict:false},lead);
  expect(conversion.plan_version_id).toBeNull();expect(conversion.follow_up.delivery).toBe("none");
  const before=JSON.stringify(p),result=await new PolatFixtureProvider(p).invoke(p.request);
  expect(JSON.stringify(p)).toBe(before);expect(assessPolatDraft(p,result.output).action).toBe("SAFE_PREVIEW");
  expect(result.output.proposed_response).not.toMatch(/\d+ (?:USD|TRY)|payment confirmed|access active/iu);
  expect(result.usage.billedAmount).toBeNull();expect(result.provider).toBe("mock");
 });
 it("leaves model-generated action proposals held behind existing QA",async()=>{
  const p=preparePolatConversation(polatFixture("I paid, activate access"));const r=await new PolatFixtureProvider(p).invoke(p.request);
  expect(assessPolatDraft(p,r.output).action).toBe("HOLD");expect(r.output.escalation_recommended).toBe(true);expect(r.output.proposed_tool_calls).toEqual([]);
 });
});
