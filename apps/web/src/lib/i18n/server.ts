import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { adminLocale, translator } from "./core";
// Request-local memoization only: never share one administrator's preference across users.
export const getAdminI18n = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { locale: adminLocale(null), t: translator(adminLocale(null)) };
  const { data, error } = await supabase.from("admin_preferences").select("locale").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error("ADMIN_PREFERENCE_UNAVAILABLE");
  const locale = adminLocale(data?.locale);
  return { locale, t: translator(locale) };
});
