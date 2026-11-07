import{describe,it,expect}from 'vitest';
import{prepareJeffFixtureRuntime}from './jeff-runtime-profile';
import{jeffSalesFixture}from './jeff-sales.fixtures';
import{prepareJeffConversation,jeffIntent}from './jeff-conversation';
import{commercialEvidence}from './commercial';
import{JEFF_TEST_PROFILE}from '@gold-revenue-os/contracts';
const run='61c07000-0000-4000-8000-000000000001';
function input(text='What is the price?'){
 const f=jeffSalesFixture(text),prepared=prepareJeffConversation(f.conversation),commercial={documents:f.catalog,conflict:false};
 return{wire:{version:1 as const,mode:'SYNTHETIC' as const,profile:JEFF_TEST_PROFILE,generation:'1',input:f.conversation,subscription_context:[],financial_authority:'NONE' as const,live_operations_authorized:false as const},context:{...prepared.request.context,commercial,commercialEvidence:commercialEvidence(commercial,{tenantId:f.conversation.tenant_id,conversationId:f.conversation.conversation_id,boundary:f.conversation.boundary,locale:'en'})}};
}
describe('same provider-neutral Jeff fixture profile for native worker and offline replay',()=>{
 it('retains exact catalog facts, unknown usage and no authority',async()=>{const x=input(),p=prepareJeffFixtureRuntime(x.wire,x.context,run),r=await p.provider.invoke(p.request);expect(r.output.proposed_response).toContain('10.00 USD');expect(p.assess(r.output).action).toBe('SAFE_PREVIEW');expect(r.usage.inputTokens).toBeNull();expect(r.usage.billedAmount).toBeNull();expect(p.prepared.financial_authority).toBe('NONE');});
 it('checks the actual returned output instead of a cached sales assessment',async()=>{const x=input(),p=prepareJeffFixtureRuntime(x.wire,x.context,run),r=await p.provider.invoke(p.request);expect(p.assess({...r.output,proposed_response:"I'm Jeff."}).reasons).toContain('JEFF_IMPERSONATION_OR_FAMILIARITY');expect(p.assess({...r.output,proposed_response:'Your payment has been verified.'}).action).toBe('HOLD');});
 it.each([{mode:'LIVE'},{financial_authority:'LIVE'},{live_operations_authorized:true},{verified:true},{generation:'0'}])('rejects unexpected authority and malformed outer context %j',patch=>{const x=input();expect(()=>prepareJeffFixtureRuntime({...x.wire,...patch},x.context,run)).toThrow();});
 it('rejects cross-tenant and ownership context',()=>{const x=input();expect(()=>prepareJeffFixtureRuntime(x.wire,{...x.context,tenantId:run},run)).toThrow('SCOPE');expect(()=>prepareJeffFixtureRuntime(x.wire,{...x.context,runtimeMode:'HUMAN_TAKEOVER'},run)).toThrow('SCOPE');});
 it('rejects altered request fingerprints without invoking an external model',async()=>{const x=input(),p=prepareJeffFixtureRuntime(x.wire,x.context,run);await expect(p.provider.invoke({...p.request,requestId:'changed'})).rejects.toThrow('JEFF_REQUEST_SCOPE_CHANGED');});
 it('does not treat disinterest as purchase intent',()=>expect(jeffIntent("I'm not interested.")).toBe('UNINTERESTED'));
 it.each(['I need rent money and will borrow to buy signals.','How much profit will I make?','My subscription expired.','I am frustrated.','Bitte antworte auf Deutsch.'])('holds exceptional source %s without a price pitch',async text=>{const x=input(text),p=prepareJeffFixtureRuntime(x.wire,x.context,run),r=await p.provider.invoke(p.request);expect(p.assess(r.output).action).toBe('HOLD');expect(r.output.proposed_response).not.toContain('10.00 USD');});
});
