import { handleTelegramStarsUatWebhook } from "@/lib/payments/telegram-stars-uat-handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request) { return handleTelegramStarsUatWebhook(request); }
export function GET() { return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { "cache-control": "no-store" } }); }
