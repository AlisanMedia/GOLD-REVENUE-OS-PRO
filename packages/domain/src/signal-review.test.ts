import{describe,it,expect}from "vitest";
import{signalReviewIssues,signalReviewDecisions}from "@gold-revenue-os/contracts";
import{parseSignalReviewCommand,projectSignalReviewSummary}from "./signal-review";
const command={version:1,mode:"SYNTHETIC",source_id:"51a53000-0000-4000-8000-000000000001",delivery_id:null,issue:"MISSING_EVENT",decision:"OPEN",reason:"EVIDENCE_MISSING",expected_context_hash:"a".repeat(64),evidence:[]};
describe("review command is never financial or delivery authority",()=>{
 it.each(signalReviewIssues)("represents %s without claiming an action",issue=>{expect(parseSignalReviewCommand(JSON.stringify({...command,issue}))).toMatchObject({financial_authority:"NONE",live_operations_authorized:false});});
 it.each(signalReviewDecisions)("%s requires DB evidence even with a valid context hash",decision=>{const r=parseSignalReviewCommand(JSON.stringify({...command,decision}));expect(r.financial_authority).toBe("NONE");expect(r.live_operations_authorized).toBe(false);expect(r.command.decision).toBe(decision);});
 it.each([{force_send:true},{financial_authority:"LIVE"},{verified:true},{provider_ack:{outcome:"ACK"}},{reviewer_id:command.source_id},{raw_callback:"private"}])("rejects authority/private field injection",extra=>{expect(()=>parseSignalReviewCommand(JSON.stringify({...command,...extra}))).toThrow();});
 it("rejects duplicate JSON keys, oversize commands and unsupported evidence",()=>{
  expect(()=>parseSignalReviewCommand(JSON.stringify(command).replace('"version":1','"version":1,"version":1'))).toThrow();
  expect(()=>parseSignalReviewCommand(" ".repeat(4097))).toThrow("SIGNAL_REVIEW_BOUND");
  expect(()=>parseSignalReviewCommand(JSON.stringify({...command,evidence:[{kind:"MANAGER_ASSERTION",id:command.source_id}]}))).toThrow();
  expect(()=>parseSignalReviewCommand(JSON.stringify({...command,evidence:Array(9).fill({kind:"SOURCE_RECOVERY",id:command.source_id})}))).toThrow();
 });
 it("does not allow repeated references to masquerade as multiple independent proofs",()=>{expect(()=>parseSignalReviewCommand(JSON.stringify({...command,evidence:Array(2).fill({kind:"SOURCE_RECOVERY",id:command.source_id})}))).toThrow();});
 it.each(["super_admin","manager","support","analyst"]as const)("%s sees only safe review metadata",role=>{const r=projectSignalReviewSummary({issue:"UNKNOWN_DELIVERY",reason:"MATCHING_FAKE_ACK",reviewer_role:"manager"},role);expect(r).toEqual({issue:"UNKNOWN_DELIVERY",reason:"MATCHING_FAKE_ACK",reviewer_role:"manager",financial_authority:"NONE",live_operations_authorized:false});});
 it("denies readonly and rejects raw private evidence in the projection",()=>{
  expect(()=>projectSignalReviewSummary({issue:"UNKNOWN_DELIVERY",reason:"EVIDENCE_MISSING",reviewer_role:"manager"},"readonly")).toThrow("SIGNAL_REVIEW_READ_DENIED");
  expect(()=>projectSignalReviewSummary({issue:"UNKNOWN_DELIVERY",reason:"EVIDENCE_MISSING",reviewer_role:"manager",lease_token:command.source_id},"analyst")).toThrow();
 });
});
