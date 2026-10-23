import { describe,it,expect } from "vitest";
import { subscriptionExpiry,entitlementValid,nextSubscriptionState,purchaseJourney } from "./subscriptions";
describe("deterministic membership duration",()=>{
 it.each([["2028-01-31T10:11:12Z","calendar_month",1,"2028-02-29T10:11:12.000Z"],["2027-01-31T10:11:12Z","calendar_month",1,"2027-02-28T10:11:12.000Z"],["2028-02-29T10:11:12Z","calendar_year",1,"2029-02-28T10:11:12.000Z"],["2028-01-31T10:11:12Z","calendar_month",2,"2028-03-31T10:11:12.000Z"],["2028-02-29T10:11:12Z","fixed_days",30,"2028-03-30T10:11:12.000Z"]])("%s %s %s",(start,unit,count,end)=>expect(subscriptionExpiry(String(start),{duration_unit:unit,duration_count:count})).toBe(end));
 it("rejects invented grace and bad dates",()=>{expect(()=>subscriptionExpiry("bad",{duration_unit:"fixed_days",duration_count:1})).toThrow();expect(()=>subscriptionExpiry("2028-01-01T00:00:00Z",{duration_unit:"fixed_days",duration_count:1,grace_days:3})).toThrow();});
 it("hold prevents entitlement and renewal cannot release it",()=>{expect(entitlementValid({state:"HOLD",ends_at:"2029-01-01",grace_until:"2029-01-01"},"2028-01-01")).toBe(false);expect(nextSubscriptionState("HOLD","renew")).toBe("HOLD");expect(()=>nextSubscriptionState("CANCELLED","renew")).toThrow();});
 it("expires at exact boundary",()=>expect(entitlementValid({state:"ACTIVE",ends_at:"2029-01-01",grace_until:"2029-01-01"},"2029-01-01")).toBe(false));
});
describe("one truthful localized journey",()=>{
 const base={paymentVerified:false,paymentState:"PENDING",entitled:false,membershipVerified:false,inviteAvailable:false,mode:"live" as const};
 it.each(["en","tr","ar","ru"] as const)("keeps %s pending until backend verification",locale=>{const r=purchaseJourney({...base,subscriptionState:"ACTIVE",membershipVerified:true,inviteAvailable:true},locale);expect(r.state).toBe("payment_pending");expect(r.action).toBe("wait");});
 it("does not claim access on subscription activation alone",()=>expect(purchaseJourney({...base,paymentVerified:true,paymentState:"CONFIRMED",subscriptionState:"ACTIVE",entitled:true}).state).toBe("access_pending"));
 it("allows one join action only after backend readiness",()=>expect(purchaseJourney({...base,paymentVerified:true,paymentState:"CONFIRMED",subscriptionState:"ACTIVE",entitled:true,inviteAvailable:true}).action).toBe("join"));
 it("labels simulations",()=>expect(purchaseJourney({...base,paymentVerified:true,entitled:true,mode:"test"}).message).toMatch(/^TEST ONLY/));
 it.each(["HOLD","SUSPENDED","CANCELLED"])("%s overrides an old invite",subscriptionState=>expect(purchaseJourney({...base,paymentVerified:true,entitled:true,inviteAvailable:true,subscriptionState}).state).toBe("review"));
 it("underpayment has no repeat payment instruction",()=>{const r=purchaseJourney({...base,paymentState:"REVIEW",reason:"UNDERPAYMENT"});expect(r.state).toBe("underpaid");expect(r.action).toBe("wait");});
});
