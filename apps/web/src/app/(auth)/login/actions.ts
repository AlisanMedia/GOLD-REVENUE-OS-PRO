"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");
  const email = (typeof rawEmail === "string" ? rawEmail : "").trim();
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!email || !password) redirect("/login?error=missing");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=invalid");
  redirect("/admin");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
