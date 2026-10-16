"use server";
import { requireUserContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
export async function changeAdminLocale(_previous: string, form: FormData): Promise<string> {
  const { user } = await requireUserContext();
  const locale = form.get("locale");
  if (locale !== "tr-TR" && locale !== "en-US") return "INVALID_LOCALE";
  const supabase = await createSupabaseServerClient();
  // RLS checks ownership, including WITH CHECK. No browser-controlled user or tenant ID.
  const { error } = await supabase.from("admin_preferences").upsert({ user_id: user.id, locale }, { onConflict: "user_id" });
  if (error) return "SAVE_FAILED";
  revalidatePath("/admin", "layout");
  return "SAVED";
}
