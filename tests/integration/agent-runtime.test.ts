import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAdminCapability } from "../../apps/web/src/lib/admin/permissions";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 6 runtime security contracts", () => {
  it("enforces the approval role matrix in UI and database-backed actions", () => {
    expect(hasAdminCapability("manager", "agents.review")).toBe(true);
    expect(hasAdminCapability("support", "agents.review")).toBe(true);
    expect(hasAdminCapability("analyst", "agents.review")).toBe(false);
    expect(hasAdminCapability("readonly", "agents.read")).toBe(false);
    expect(read("apps/web/src/app/admin/agent-runs/[id]/actions.ts")).toContain('requireAdminCapability("agents.review")');
    expect(read("apps/web/src/app/admin/agent-runs/[id]/actions.ts")).toContain("review_agent_proposal");
  });

  it("protects the deterministic worker with a server-only cron secret", () => {
    const route = read("apps/web/src/app/api/internal/agent-worker/route.ts");
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("timingSafeEqual");
    expect(route).not.toMatch(/NEXT_PUBLIC_.*SECRET/);
    expect(read("vercel.json")).toContain("/api/internal/agent-worker");
  });

  it("uses the Phase 3 outbox/inbox instead of an external queue", () => {
    const worker = read("apps/web/src/lib/agent-runtime/worker.ts");
    expect(worker).toContain('"claim_event_outbox"');
    expect(worker).toContain('"begin_event_consumption"');
    expect(worker).toContain('"complete_event_outbox"');
    expect(worker).not.toMatch(/bullmq|redis|upstash/i);
  });

  it("keeps model context bounded and excludes secret-shaped fields", () => {
    const context = read("apps/web/src/lib/agent-runtime/context-builder.ts");
    expect(context).toContain("CONTEXT_LIMITS.messages");
    expect(context).toContain("CONTEXT_LIMITS.memoryItems");
    expect(context).toContain("assertSafeContext(context)");
    expect(context).not.toMatch(/SUPABASE_SECRET_KEY|TELEGRAM_BOT_TOKEN|CRON_SECRET/);
  });

  it("keeps historical import locked and AI outbound non-autonomous", () => {
    expect(read("apps/web/src/app/api/v1/imports/[id]/commit/route.ts")).toContain("IMPORT_EXECUTION_LOCKED");
    const worker = read("apps/web/src/lib/agent-runtime/worker.ts");
    expect(worker).not.toContain("sendTelegramText");
    expect(worker).not.toContain("queue_outbound_message");
  });
});

