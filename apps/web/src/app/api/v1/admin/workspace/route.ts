import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserContext } from "@/lib/auth/context";
import { ADMIN_TENANT_COOKIE, tenantSelectionValue } from "@/lib/auth/tenant-selection";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "ORIGIN_DENIED" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? "0") > 512) return NextResponse.json({ error: "INVALID_WORKSPACE" }, { status: 400 });
  const context = await getUserContext();
  if (!context) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  let id: string;
  try {
    const form = await request.formData();
    if ([...form.keys()].length !== 1) throw Error("invalid");
    id = z.uuid().parse(form.get("tenant_id"));
  } catch { return NextResponse.json({ error: "INVALID_WORKSPACE" }, { status: 400 }); }
  if (!context.tenants.some(t => t.id === id)) return NextResponse.json({ error: "WORKSPACE_DENIED" }, { status: 403 });
  const response = NextResponse.redirect(new URL("/admin/polat-operations?view=beta", request.url), 303);
  response.cookies.set(ADMIN_TENANT_COOKIE, tenantSelectionValue(context.user.id, id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400 });
  response.headers.set("cache-control", "no-store");
  return response;
}
