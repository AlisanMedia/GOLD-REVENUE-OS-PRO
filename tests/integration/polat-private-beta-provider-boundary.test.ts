import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import ts from "typescript";

describe("private beta provider remains a Node-only explicit server capability", () => {
  it("has no browser/default-export path or client-visible credential loader", () => {
    const pkg = JSON.parse(readFileSync(resolve("packages/domain/package.json"), "utf8"));
    expect(pkg.exports["./polat-private-beta-provider"]).toEqual({ node: "./src/polat-private-beta-provider.ts" });
    const browser = ts.resolveModuleName("@gold-revenue-os/domain/polat-private-beta-provider", resolve("apps/web/src/browser-boundary.ts"), { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, customConditions: ["browser"] }, ts.sys);
    expect(browser.resolvedModule).toBeUndefined();
    expect(readFileSync(resolve("packages/domain/src/index.ts"), "utf8")).not.toMatch(/from ["']\.\/polat-private-beta-provider["']/u);
    expect(readFileSync(resolve("apps/web/src/lib/polat/private-beta-provider.ts"), "utf8")).toContain('import "server-only"');
  });
  it("imports its explicit Node module without creating a request, obtaining a credential or activating legacy experiments", () => {
    const code = "let calls=0;globalThis.fetch=()=>{calls++;throw Error('NETWORK_FORBIDDEN')};const https=await import('node:https');https.default.request=()=>{calls++;throw Error('NETWORK_FORBIDDEN')};const m=await import('@gold-revenue-os/domain/polat-private-beta-provider');const shared=await import('@gold-revenue-os/domain');if(calls||typeof m.createPolatPrivateBetaProvider!=='function'||shared.createPolatPrivateBetaProvider||shared.readPolatAnthropicUatAccount)throw Error('ISOLATION_FAILED');process.stdout.write(JSON.stringify({network:calls,credential_reads:0,shared_provider:false}));";
    const child = spawnSync(process.execPath, ["--experimental-transform-types", "--import", resolve("scripts/polat-typescript-resolver.mjs"), "--input-type=module", "-e", code], { cwd: resolve("apps/web"), encoding: "utf8", timeout: 10000 });
    expect(child.error, child.error?.message).toBeUndefined(); expect(child.status, child.stderr).toBe(0); expect(child.stdout).not.toBe(""); expect(JSON.parse(child.stdout)).toEqual({ network: 0, credential_reads: 0, shared_provider: false });
  });
});
