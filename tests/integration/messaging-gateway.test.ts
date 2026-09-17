import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAdminCapability } from "../../apps/web/src/lib/admin/permissions";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 5 messaging security contracts", () => {
  it("enforces the messaging role matrix in application and database layers", () => {
    for (const role of ["super_admin", "manager", "support"] as const) {
      expect(hasAdminCapability(role, "messaging.read")).toBe(true);
      expect(hasAdminCapability(role, "messaging.send")).toBe(true);
    }
    for (const role of ["analyst", "readonly"] as const) {
      expect(hasAdminCapability(role, "messaging.read")).toBe(false);
      expect(hasAdminCapability(role, "messaging.send")).toBe(false);
    }
    expect(hasAdminCapability("manager", "messaging.kill_switch")).toBe(true);
    expect(hasAdminCapability("support", "messaging.kill_switch")).toBe(false);
  });

  it("validates Telegram webhook security before persistence", () => {
    const webhook = read("apps/web/src/app/api/webhooks/telegram/route.ts");
    expect(webhook).toContain("x-telegram-bot-api-secret-token");
    expect(webhook).toContain("timingSafeEqual");
    expect(webhook).toContain("MAX_WEBHOOK_BYTES");
    expect(webhook).toContain("HTTPS_REQUIRED");
    expect(webhook).toContain("parseTelegramPrivateText");
    expect(webhook).not.toMatch(/console\.(?:log|info|debug)/);
  });

  it("keeps provider secrets server-only and out of public environment variables", () => {
    const env = read("apps/web/src/lib/messaging/server-env.ts");
    const adapter = read("apps/web/src/lib/messaging/telegram-adapter.ts");
    const allClientFiles = [
      read("apps/web/src/components/manual-message-reply.tsx"),
      read("apps/web/src/components/outbound-kill-switch.tsx"),
    ].join("\n");
    expect(env).toContain('import "server-only"');
    expect(adapter).toContain('import "server-only"');
    expect(allClientFiles).not.toMatch(/TELEGRAM_BOT_TOKEN|SUPABASE_SECRET_KEY|TELEGRAM_WEBHOOK_SECRET/);
    expect(read(".gitignore")).toMatch(/\.env/);
  });

  it("uses durable records and Phase 3 event contracts without copying content to events", () => {
    const migration = read("supabase/migrations/20260917090000_phase5_messaging_gateway.sql");
    expect(migration).toContain("private.append_domain_event");
    expect(migration).toContain("'message.received'");
    expect(migration).toContain("'message.sent'");
    expect(migration).toContain("'conversation_id', conversation_value.id");
    expect(migration).not.toMatch(/jsonb_build_object\([^)]*'content'/s);
    expect(migration).toContain("outbound_messaging_enabled boolean not null default false");
  });

  it("prevents duplicate HTTP sends for a repeated outbound idempotency key", () => {
    const route = read("apps/web/src/app/api/v1/conversations/[id]/messages/route.ts");
    expect(route).toContain("IDEMPOTENCY_KEY_REQUIRED");
    expect(route).toContain("queued.duplicate === true");
    expect(route.indexOf("queued.duplicate === true")).toBeLessThan(route.indexOf("await sendTelegramText"));
  });

  it("keeps historical import locked and contains no AI runtime", () => {
    expect(read("apps/web/src/app/api/v1/imports/[id]/commit/route.ts")).toContain("IMPORT_EXECUTION_LOCKED");
    const messagingFiles = [
      read("apps/web/src/lib/messaging/telegram-adapter.ts"),
      read("apps/web/src/app/api/webhooks/telegram/route.ts"),
      read("apps/web/src/app/api/v1/conversations/[id]/messages/route.ts"),
    ].join("\n");
    expect(messagingFiles).not.toMatch(/openai|chatgpt|llm|autonomous/i);
  });
});
