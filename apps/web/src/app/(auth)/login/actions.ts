"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const recovery = formData.getAll("mfa_recovery").length === 1 && formData.get("mfa_recovery") === "1";
  const loginError = (error: "missing" | "invalid") => recovery ? `/login?mfa_recovery=1&error=${error}` : `/login?error=${error}`;
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");
  const email = (typeof rawEmail === "string" ? rawEmail : "").trim();
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!email || !password) redirect(loginError("missing"));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(loginError("invalid"));
  redirect(recovery ? "/admin/polat-operations?view=beta#private-beta-mfa-title" : "/admin");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
