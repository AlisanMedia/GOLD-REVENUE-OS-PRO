import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error("SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required");
}

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const client = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = randomUUID();
const email = `phase1-smoke+${runId}@example.test`;
const password = `${randomBytes(24).toString("base64url")}Aa1!`;
const tenantId = "00000000-0000-4000-8000-000000000101";
let userId;

function assertNoError(label, error) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Phase 1 Smoke" },
  });
  assertNoError("create auth user", createError);
  userId = created.user?.id;
  if (!userId) throw new Error("create auth user: no user id returned");

  const { error: tenantError } = await admin.from("tenants").upsert(
    {
      id: tenantId,
      name: "Phase 1 Auth Smoke",
      slug: "phase-1-auth-smoke",
      status: "active",
    },
    { onConflict: "id" },
  );
  assertNoError("upsert smoke tenant", tenantError);

  const { error: membershipError } = await admin.from("tenant_members").insert({
    tenant_id: tenantId,
    user_id: userId,
    role: "manager",
    status: "active",
  });
  assertNoError("create smoke membership", membershipError);

  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  assertNoError("password sign in", signInError);
  if (signedIn.user?.id !== userId || !signedIn.session?.access_token) {
    throw new Error("password sign in: invalid session result");
  }

  const { data: tenants, error: tenantReadError } = await client
    .from("tenants")
    .select("id,slug")
    .order("slug");
  assertNoError("tenant-scoped read", tenantReadError);
  if (tenants?.length !== 1 || tenants[0]?.id !== tenantId) {
    throw new Error("tenant-scoped read: expected exactly the smoke tenant");
  }

  const { data: auditRows, error: auditError } = await client
    .from("audit_logs")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1);
  assertNoError("manager audit read", auditError);
  if (!auditRows?.length) throw new Error("manager audit read: no audit record visible");

  const { error: signOutError } = await client.auth.signOut();
  assertNoError("sign out", signOutError);

  console.log(JSON.stringify({
    status: "PASS",
    checks: ["admin-create-user", "password-sign-in", "session", "tenant-rls", "manager-audit-read", "sign-out"],
  }));
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`cleanup warning: ${error.message}`);
  }
}
