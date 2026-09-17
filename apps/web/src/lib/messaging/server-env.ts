import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

function requiredServerSecret(name: "SUPABASE_SECRET_KEY" | "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET" | "TELEGRAM_STAGING_TENANT_ID"): string {
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

export function createSupabaseAdminClient() {
  const env = publicEnv();
  const secretKey = requiredServerSecret("SUPABASE_SECRET_KEY");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
