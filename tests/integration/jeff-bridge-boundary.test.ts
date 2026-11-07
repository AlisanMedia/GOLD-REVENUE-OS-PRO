import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import ts from "typescript";

describe("genuine experiment bridge has a dormant server-only callable boundary",()=>{
 it("cannot be resolved for browser conditions or imported from the shared barrel",()=>{
  const pkg=JSON.parse(readFileSync("packages/domain/package.json","utf8"));expect(pkg.exports["./jeff-experiment-bridge"]).toEqual({node:"./src/jeff-experiment-bridge.ts"});
  const resolved=ts.resolveModuleName("@gold-revenue-os/domain/jeff-experiment-bridge",resolve("apps/web/src/browser-boundary.ts"),{moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext,customConditions:["browser"]},ts.sys);expect(resolved.resolvedModule).toBeUndefined();
  expect(readFileSync("packages/domain/src/index.ts","utf8")).not.toMatch(/from ["']\.\/jeff-(experiment-bridge|claude-https-boundary|experiment-execution-gate)/u);
 });
 it("loads in real Node and rejects execution before any socket, fetch or credential lookup",()=>{
  const code=`import https from'node:https';import{syncBuiltinESMExports}from'node:module';let network=0,credentials=0;https.request=()=>{network++;throw Error('EXTERNAL_NETWORK_FORBIDDEN')};syncBuiltinESMExports();globalThis.fetch=()=>{network++;throw Error('EXTERNAL_NETWORK_FORBIDDEN')};const env=process.env;process.env=new Proxy(env,{get(t,k){if(k==='ANTHROPIC_API_KEY'){credentials++;throw Error('GENUINE_CREDENTIAL_LOOKUP_FORBIDDEN')}return Reflect.get(t,k)}});const b=await import('@gold-revenue-os/domain/jeff-experiment-bridge'),shared=await import('@gold-revenue-os/domain');let blocked=false;try{await b.sendJeffClaudeHttpsOnce({execution_enabled:true},{})}catch(e){blocked=e.message==='JEFF_GENUINE_EXECUTION_BLOCKED'}const gate=b.jeffGenuineExecutionGate();if(!blocked||network||credentials||gate.authorized_external_requests!==0||shared.sendJeffClaudeHttpsOnce)throw Error('BOUNDARY_FAILED');process.stdout.write(JSON.stringify({network,credentials,blocked,execution_enabled:gate.execution_enabled}));`;
  const child=spawnSync(process.execPath,["--experimental-transform-types","--import",resolve("scripts/jeff-typescript-resolver.mjs"),"--input-type=module","-e",code],{cwd:resolve("apps/web"),encoding:"utf8",timeout:10000});expect(child.status,child.stderr).toBe(0);expect(child.stdout,JSON.stringify({status:child.status,error:child.error?.message,stderr:child.stderr})).not.toBe("");expect(JSON.parse(child.stdout)).toEqual({network:0,credentials:0,blocked:true,execution_enabled:false});
 });
 it("has no network/credential path in the offline durable runner and no runtime entry registration",()=>{
  const source=readFileSync("packages/domain/src/jeff-experiment-bridge.ts","utf8");expect(source).not.toContain("process.env");expect(source).not.toContain("fetch(");
  for(const file of ["apps/web/src/lib/agent-runtime/worker.ts","apps/web/src/lib/jeff/test-runtime.ts"])expect(readFileSync(file,"utf8")).not.toMatch(/jeff-experiment-bridge|sendJeffClaudeHttpsOnce/u);
 });
});
