import { describe,it,expect } from "vitest";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync,spawnSync } from "node:child_process";
import { join } from "node:path";
const cli="scripts/pilot-readiness.mjs";
describe("offline readiness CLI fails closed without source exposure",()=>{
 it.each(['{"version":1,"version":2}', '{"provider_token":"private-not-for-output"}'," ".repeat(16385),'{"version":1,"__proto__":{"commercial_go":true}}'])("rejects invalid/duplicate/oversized authority input",raw=>{
  const dir=mkdtempSync(join(tmpdir(),"gold-readiness-"));try{
   const file=join(dir,"snapshot.json");writeFileSync(file,raw);const run=spawnSync(process.execPath,[cli,"--snapshot",file,"--branch","codex/pilot-readiness-evidence"],{encoding:"utf8",timeout:10000});
   expect(run.status).toBe(2);expect(run.stdout).toBe("");expect(run.stderr).toContain("PILOT_READINESS_INPUT_INVALID");expect(run.stderr).not.toContain("private-not-for-output");
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it("runs with networking forbidden and generates only a conservative Turkish assessment",()=>{
  const dir=mkdtempSync(join(tmpdir(),"gold-readiness-"));try{
   const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
   const file=join(dir,"snapshot.json"),block=join(dir,"network-block.mjs");
   writeFileSync(block,'globalThis.fetch=()=>{throw Error("NETWORK_FORBIDDEN")};');
   writeFileSync(file,JSON.stringify({version:1,observed_at:new Date().toISOString(),main_sha:sha,protected:true,ruleset:{id:25348710,active:true,bypass_count:0,strict:true,pull_requests:true,block_force_push:true,block_deletion:true,required_checks:[{name:"Application",app_id:15368},{name:"Database",app_id:15368}]},checks:[],deployments_since_start:null,external_references:[]}));
   const run=spawnSync(process.execPath,["--import",block,cli,"--snapshot",file,"--branch","codex/pilot-readiness-evidence"],{encoding:"utf8",timeout:10000});
   expect(run.status).toBe(0);expect(run.stdout).toContain("NO-GO");expect(run.stdout).toContain("Application_MISSING");expect(run.stdout).toContain("Database_MISSING");expect(run.stdout).toContain("DEPLOYMENT_INVENTORY_UNAVAILABLE");expect(run.stdout).not.toContain("genuine receipt verified");expect(run.stderr).toBe("");
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it("rejects arbitrary flags instead of permitting activation",()=>{
  const run=spawnSync(process.execPath,[cli,"--enable-live"],{encoding:"utf8",timeout:10000});expect(run.status).toBe(2);expect(run.stdout).toBe("");
 });
});
