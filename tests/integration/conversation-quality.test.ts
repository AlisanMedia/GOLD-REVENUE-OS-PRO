import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAdminCapability } from "../../apps/web/src/lib/admin/permissions";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 7 conversation quality security contracts", () => {
  it("keeps the OpenAI credential server-only and out of prompts/browser code", () => {
    const provider = read("apps/web/src/lib/agent-runtime/providers/openai-responses.ts");
    expect(provider).toContain('process.env.OPENAI_API_KEY');
    expect(provider).toContain('import "server-only"');
    expect(provider).toContain("store: false");
    expect(provider).not.toContain("NEXT_PUBLIC_OPENAI");
    expect(read("apps/web/src/app/admin/agent-quality/page.tsx")).not.toMatch(/OPENAI_API_KEY|Bearer /);
  });

  it("keeps model output behind deterministic quality and approval gates", () => {
    const worker = read("apps/web/src/lib/agent-runtime/worker.ts");
    expect(worker).toContain("directConversation");
    expect(worker).toContain("evaluateConversationQuality");
    expect(worker).toContain("complete_quality_agent_run");
    expect(worker).not.toContain("sendTelegramText");
    expect(worker).not.toContain("queue_outbound_message");
  });

  it("requires a separate authorized human action for approved draft sending", () => {
    const actions = read("apps/web/src/app/admin/agent-runs/[id]/actions.ts");
    expect(actions).toContain('requireAdminCapability("agents.review")');
    expect(actions).toContain('hasAdminCapability(context.role, "messaging.send")');
    expect(actions).toContain("queue_approved_agent_proposal");
    expect(actions).toContain("dispatchQueuedTelegramMessage");
    expect(hasAdminCapability("analyst", "messaging.send")).toBe(false);
    expect(hasAdminCapability("readonly", "agents.review")).toBe(false);
  });

  it("keeps the historical customer import gate locked", () => {
    expect(read("apps/web/src/app/api/v1/imports/[id]/commit/route.ts")).toContain("IMPORT_EXECUTION_LOCKED");
  });

  it("does not expose generic mutation or execution tools", () => {
    const gateway = read("apps/web/src/lib/agent-runtime/tool-gateway.ts");
    expect(gateway).not.toMatch(/execute_sql|arbitrary_fetch|database_write/);
    const runtime = read("packages/domain/src/agent-runtime.ts");
    expect(runtime).not.toContain('"execute_sql":');
    expect(runtime).not.toContain('"http_request":');
  });
});
