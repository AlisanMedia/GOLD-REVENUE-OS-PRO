import { describe,it,expect } from "vitest";
import { assessPilotReadiness,pilotSnapshotSchema,pilotReadinessMarkdown,PILOT_GATES } from "./pilot-readiness";
const head="a".repeat(40),time="2026-10-23T17:00:00Z";
const valid=()=>({version:1,observed_at:time,main_sha:head,protected:true,ruleset:{id:25348710,active:true,bypass_count:0,strict:true,pull_requests:true,block_force_push:true,block_deletion:true,required_checks:[{name:"Application",app_id:15368},{name:"Database",app_id:15368}]},
 checks:[{name:"Application",id:1,run_id:11,app_id:15368,head_sha:head,status:"completed",conclusion:"success",url:"https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/11/job/1"},{name:"Database",id:2,run_id:11,app_id:15368,head_sha:head,status:"completed",conclusion:"success",url:"https://github.com/AlisanMedia/GOLD-REVENUE-OS-PRO/actions/runs/11/job/2"}],deployments_since_start:0,external_references:[]});
const local={target_sha:head,working_tree_clean:true,branch_deployment_disabled:true,main_deployment_disabled:true,deployment_policy_preserved:true};
describe("offline pilot-entry conformance is never genuine authority",()=>{
 it("separates technical PASS from commercial NO-GO and external blockers",()=>{
  const view=assessPilotReadiness(valid(),local,time);expect(view.repository_controls.status).toBe("PASS");expect(view.commercial_verdict).toBe("NO_GO");expect(view.financial_authority).toBe("NONE");expect(view.live_operations_authorized).toBe(false);expect(view.evidence_validation).toBe("OFFLINE_CONSISTENCY_ONLY");
  expect(view.gates.map(g=>g.id)).toEqual([...PILOT_GATES]);expect(view.gates.map(g=>g.status)).not.toContain("PASS");
 });
 it.each(["failure","cancelled","skipped","neutral","timed_out","action_required","stale",null])("%s required conclusion cannot satisfy the gate",conclusion=>{
  const data={...valid(),checks:valid().checks.map((c,i)=>i===1?{...c,conclusion}:c)};
  expect(assessPilotReadiness(data,local,time).repository_controls.status).toBe("FAIL");
 });
 it.each(["queued","in_progress"])("%s is not a completed required check",status=>{
  const data=valid();data.checks[0]!.status=status;expect(assessPilotReadiness(data,local,time).repository_controls.status).toBe("FAIL");
 });
 it("missing Database is NOT TESTED, never inferred from Application",()=>{
  const data=valid();data.checks=data.checks.slice(0,1);const view=assessPilotReadiness(data,local,time);expect(view.repository_controls.status).toBe("NOT_TESTED");expect(view.repository_controls.reasons).toContain("Database_MISSING");
 });
 it.each(["app_id","head_sha","url"])("rejects wrong check %s provenance",field=>{
  const data=valid();if(field==="app_id")data.checks[1]!.app_id=1;else if(field==="head_sha")data.checks[1]!.head_sha="b".repeat(40);else data.checks[1]!.url=data.checks[0]!.url;
  expect(assessPilotReadiness(data,local,time).repository_controls.reasons).toContain("Database_SOURCE_MISMATCH");
 });
 it("conflicting duplicate checks cannot cherry-pick an old success",()=>{
  const data=valid();data.checks.push({...data.checks[0]!,id:3,conclusion:"failure"});expect(assessPilotReadiness(data,local,time).repository_controls.reasons).toContain("Application_AMBIGUOUS");
 });
 it.each(["active","strict","pull_requests","block_force_push","block_deletion"] as const)("requires actual governance observation %s",key=>{
  const data=valid();data.ruleset[key]=false;expect(assessPilotReadiness(data,local,time).repository_controls.reasons).toContain("GOVERNANCE_NOT_CONFIRMED");
 });
 it("bypass, unprotected main and wrong ruleset cannot pass",()=>{
  const data=valid();data.protected=false;data.ruleset.bypass_count=1;data.ruleset.id=1;expect(assessPilotReadiness(data,local,time).repository_controls.status).toBe("FAIL");
 });
 it("both check contexts must be required from the expected app",()=>{
  const data=valid();data.ruleset.required_checks[1]!.app_id=1;expect(assessPilotReadiness(data,local,time).repository_controls.reasons).toContain("Database_NOT_MANDATORY");
 });
 it.each(["working_tree_clean","branch_deployment_disabled","main_deployment_disabled","deployment_policy_preserved"] as const)("fails closed without %s",key=>{
  expect(assessPilotReadiness(valid(),{...local,[key]:false},time).repository_controls.status).toBe("FAIL");
 });
 it("unknown deployment inventory is unavailable, not zero",()=>{
  expect(assessPilotReadiness({...valid(),deployments_since_start:null},local,time).repository_controls.status).toBe("NOT_TESTED");
 });
 it("an observed unauthorized deployment remains FAIL even if later removed",()=>{
  expect(assessPilotReadiness({...valid(),deployments_since_start:1},local,time).repository_controls.reasons).toContain("UNAUTHORIZED_DEPLOYMENT_OBSERVED");
 });
 it("wrong main, future and stale evidence are not accepted",()=>{
  expect(assessPilotReadiness({...valid(),main_sha:"b".repeat(40)},local,time).repository_controls.status).toBe("FAIL");
  expect(assessPilotReadiness(valid(),local,"2026-10-23T16:59:59Z").repository_controls.reasons).toContain("FUTURE_SNAPSHOT");
  expect(assessPilotReadiness(valid(),local,"2026-10-23T17:30:01Z").repository_controls.status).toBe("NOT_TESTED");
 });
 it("all supplied external hashes stay unverified, never owner/legal/payment approval",()=>{
  const data={...valid(),external_references:PILOT_GATES.map(gate=>({gate,kind:"UNVERIFIED_REFERENCE",reference_hash:"c".repeat(64)}))};
  const view=assessPilotReadiness(data,local,time);expect(view.gates.every(g=>g.unverified_reference_count===1)).toBe(true);expect(view.gates.map(g=>g.status)).not.toContain("PASS");expect(view.commercial_verdict).toBe("NO_GO");
 });
 it.each([{commercial_go:true},{financial_authority:"LIVE"},{owner_approved:true},{provider_token:"private-not-for-output"}])("rejects unexpected authority fields",extra=>expect(pilotSnapshotSchema.safeParse({...valid(),...extra}).success).toBe(false));
 it("bounds source records and excludes arbitrary URLs",()=>{
  expect(pilotSnapshotSchema.safeParse({...valid(),checks:Array(11).fill(valid().checks[0])}).success).toBe(false);
  const data=valid();data.checks[0]!.url="https://example.test/private-token";expect(pilotSnapshotSchema.safeParse(data).success).toBe(false);
 });
 it("Turkish report names the real open decisions, not a readiness percentage or financial result",()=>{
  const text=pilotReadinessMarkdown(assessPilotReadiness(valid(),local,time));expect(text).toContain("NO-GO");expect(text).toContain("C01");expect(text).toContain("C10");expect(text).toContain("çevrimdışı");expect(text).toContain("ayrı owner GO");expect(text).not.toContain("100% hazır");expect(text).not.toContain("private-not-for-output");
 });
});
