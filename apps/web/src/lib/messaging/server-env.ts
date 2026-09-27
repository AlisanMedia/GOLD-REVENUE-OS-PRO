import "server-only";

function requiredServerSecret(name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET" | "TELEGRAM_STAGING_TENANT_ID"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

export function telegramServerEnv() {
  return {
    botToken: requiredServerSecret("TELEGRAM_BOT_TOKEN"),
    webhookSecret: requiredServerSecret("TELEGRAM_WEBHOOK_SECRET"),
    tenantId: requiredServerSecret("TELEGRAM_STAGING_TENANT_ID"),
  };
}

export { createSupabaseAdminClient } from "@/lib/supabase/admin";
