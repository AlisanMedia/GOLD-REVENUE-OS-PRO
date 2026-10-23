import { describe, it, expect } from "vitest";
import { purchaseJourney, subscriptionExpiry } from "./subscriptions";
const ready={paymentVerified:true,paymentState:"CONFIRMED",subscriptionState:"ACTIVE",entitled:true,membershipVerified:false,inviteAvailable:false,mode:"test" as const};
describe("commercial status truth without financial mutation",()=>{
 it.each(["FAILED","REFUNDED","REVIEW","unknown","payment.confirmed"])("%s cannot be overridden by stale verified/membership flags",paymentState=>{
  const view=purchaseJourney({...ready,paymentState,membershipVerified:true,inviteAvailable:true});expect(view.state).toBe("review");expect(view.action).toBe("wait");
 });
 it("expired invoice keeps precedence over old active membership",()=>{
  const view=purchaseJourney({...ready,paymentState:"EXPIRED",membershipVerified:true,inviteAvailable:true});expect(view.state).toBe("payment_expired");expect(view.action).toBe("select");
 });
 it.each(["CREATED","PENDING"])("%s with contradictory verified flag requires review",paymentState=>expect(purchaseJourney({...ready,paymentState,inviteAvailable:true}).state).toBe("review"));
 it.each([undefined,"unknown","PAID"])("missing/unsupported subscription %s cannot imply an active membership",subscriptionState=>{
  const input=subscriptionState===undefined?{...ready}:{...ready,subscriptionState};if(subscriptionState===undefined)delete (input as Partial<typeof input>).subscriptionState;
  expect(purchaseJourney({...input,membershipVerified:true,inviteAvailable:true}).state).toBe("review");
 });
 it.each(["en","tr","ar","ru"] as const)("preserves %s without promising an automatic page refresh",locale=>{
  const view=purchaseJourney({...ready,paymentVerified:false,paymentState:"PENDING",entitled:false},locale);
  expect(view.state).toBe("payment_pending");expect(view.message.length).toBeGreaterThan(20);expect(view.message).not.toMatch(/automatically|otomatik|автоматически|تلقائياً/u);
 });
 it.each(["HOLD","SUSPENDED","CANCELLED"])("%s suppresses historical membership and invitations",subscriptionState=>{
  expect(purchaseJourney({...ready,subscriptionState,membershipVerified:true,inviteAvailable:true}).state).toBe("review");
 });
 it.each(["PENDING","INVITED","REVOKED","REVIEW","unknown"])("member flag with access %s cannot claim active",accessState=>{
  expect(purchaseJourney({...ready,accessState,membershipVerified:true}).state).toBe("review");
 });
 it.each(["PENDING","MEMBER","REVOKED","REVIEW","unknown"])("invite flag with access %s cannot authorize joining",accessState=>{
  expect(purchaseJourney({...ready,accessState,inviteAvailable:true}).action).toBe("wait");
 });
 it("an actually consistent read projection retains active/join/pending distinctions",()=>{
  expect(purchaseJourney({...ready,accessState:"MEMBER",membershipVerified:true}).state).toBe("active");
  expect(purchaseJourney({...ready,accessState:"INVITED",inviteAvailable:true}).action).toBe("join");
  expect(purchaseJourney({...ready,accessState:"PENDING"}).state).toBe("access_pending");
 });
 it("the exact grace boundary expires without extending immutable billing terms",()=>{
  expect(purchaseJourney({...ready,entitled:false,inviteAvailable:true}).state).toBe("expired");
  expect(subscriptionExpiry("2028-01-31T12:00:00Z",{duration_unit:"calendar_month",duration_count:1})).toBe("2028-02-29T12:00:00.000Z");
 });
 it("all TEST statuses stay simulations and expose no authority or effect payload",()=>{
  for(const paymentState of ["CREATED","PENDING","CONFIRMED","REVIEW","REFUNDED","EXPIRED","FAILED"]){
   const view=purchaseJourney({...ready,paymentState});expect(view.message).toMatch(/^TEST ONLY/u);expect(Object.keys(view).sort()).toEqual(["action","message","state"]);
  }
 });
});
