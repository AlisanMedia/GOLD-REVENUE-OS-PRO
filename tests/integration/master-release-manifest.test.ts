import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
const run=(args:string[]=[])=>spawnSync(process.execPath,["--experimental-transform-types","--import",resolve("scripts/polat-typescript-resolver.mjs"),resolve("scripts/master-release-manifest.mjs"),...args],{encoding:"utf8",timeout:10000});
describe("exact-SHA, exact-migration offline release inventory",()=>{
 it("generates and independently revalidates a disabled release inventory",()=>{
  const dir=mkdtempSync(join(tmpdir(),"gold-master-release-"));try{const first=run();expect(first.status,first.stderr).toBe(0);const m=JSON.parse(first.stdout);expect(m.repository_sha).toBe(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim());expect(m.migrations.length).toBeGreaterThan(60);expect(m).toMatchObject({model_requests:0,telegram_sends:0,deployment_enabled:false,commercial_verdict:"NO_GO"});const p=join(dir,"inventory.json");writeFileSync(p,first.stdout);const checked=run(["--check",p]);expect(checked.status,checked.stderr).toBe(0);expect(JSON.parse(checked.stdout)).toMatchObject({artifact_consistency:"PASS",hosted_acceptance:"NOT_TESTED",execution_authority:"NONE"});m.migrations[0].sha256="0".repeat(64);writeFileSync(p,JSON.stringify(m));expect(run(["--check",p]).status).toBe(2);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it("no flag can authorize deploy, inference or a genuine financial writer",()=>{for(const flag of["--approve","--deploy","--execute","--model-key"]){const r=run([flag]);expect(r.status).toBe(2);expect(r.stderr).not.toMatch(/ANTHROPIC_API_KEY|bot[0-9]+:/u);}});
});
