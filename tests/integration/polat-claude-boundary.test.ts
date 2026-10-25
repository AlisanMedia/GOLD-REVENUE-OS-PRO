import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

describe("Claude adapter package boundary",()=>{
 it("cannot resolve the adapter for a browser and does not export it from the shared entry",()=>{
  const pkg=JSON.parse(readFileSync(resolve("packages/domain/package.json"),"utf8"));
  expect(pkg.exports["./polat-claude-adapter"]).toEqual({node:"./src/polat-claude-adapter.ts"});
  const result=ts.resolveModuleName("@gold-revenue-os/domain/polat-claude-adapter",resolve("apps/web/src/browser-boundary.ts"),{moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext,customConditions:["browser"]},ts.sys);
  expect(result.resolvedModule).toBeUndefined();
  expect(readFileSync(resolve("packages/domain/src/index.ts"),"utf8")).not.toMatch(/from ["']\.\/polat-claude-adapter/);
 });
 it("loads the explicit node entry with no inference, while default imports lack an adapter factory",()=>{
  const code=`let network=0;globalThis.fetch=()=>{network++;throw Error('EXTERNAL_REQUEST_FORBIDDEN')};const adapter=await import('@gold-revenue-os/domain/polat-claude-adapter');const shared=await import('@gold-revenue-os/domain');const gate=adapter.polatClaudeRealExecutionReadiness();if(network||shared.createPolatClaudeOfflineProvider||gate.state!=='BLOCKED'||gate.authorized_external_requests!==0)throw Error('BOUNDARY_FAILED');process.stdout.write(JSON.stringify({network,adapter_in_shared:false,real_model_execution:gate.real_model_execution}));`;
  const child=spawnSync(process.execPath,["--experimental-transform-types","--import",resolve("scripts/polat-typescript-resolver.mjs"),"--input-type=module","-e",code],{cwd:resolve("apps/web"),encoding:"utf8",timeout:10000});
  expect(child.status,child.stderr).toBe(0);expect(child.stdout,JSON.stringify({executable:process.execPath,status:child.status,signal:child.signal,error:child.error?.message,stderr:child.stderr})).not.toBe("");expect(JSON.parse(child.stdout.trim())).toEqual({network:0,adapter_in_shared:false,real_model_execution:false});
 });
});
