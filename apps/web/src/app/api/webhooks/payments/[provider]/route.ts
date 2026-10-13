import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyTestWebhookAuthentication } from "@/lib/payments/adapters";
import { configuredTestAdapter, getTestInvoice, recordVerifiedTestObservation, sandboxWebhookWindowActive } from "@/lib/payments/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const provider = (await context.params).provider;
  if (!["telegram_stars_test", "external_crypto_test"].includes(provider)) return NextResponse.json({ error: "LIVE_PAYMENTS_NOT_ACTIVATED" }, { status: 503 });
  const secret = process.env.PAYMENT_TEST_WEBHOOK_SECRET?.trim();
  if (process.env.PAYMENT_TEST_WEBHOOKS_ENABLED !== "true" || !secret || secret.length < 32) return NextResponse.json({ error: "TEST_WEBHOOK_DISABLED" }, { status: 503 });
  if (process.env.NODE_ENV === "production" && new URL(request.url).protocol !== "https:" && request.headers.get("x-forwarded-proto") !== "https") return NextResponse.json({ error: "HTTPS_REQUIRED" }, { status: 400 });
  if (Number(request.headers.get("content-length") ?? 0) > 16384) return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  // Bound actual streamed bytes; Content-Length is an untrusted hint.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "PAYLOAD_REQUIRED" }, { status: 400 });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 }); }
      chunks.push(value);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const input = { rawBody, signature: request.headers.get("x-payment-test-signature") ?? "", timestamp: request.headers.get("x-payment-test-timestamp") ?? "", now: Date.now() };
    // Authenticate before any database lookup. Only persisted simulations can be observed.
    verifyTestWebhookAuthentication(input, secret);
    const signal = z.object({ invoice_id: z.uuid() }).passthrough().parse(JSON.parse(rawBody));
    const invoice = await getTestInvoice(signal.invoice_id);
    if (!await sandboxWebhookWindowActive(invoice.tenant_id)) return NextResponse.json({ error: "SANDBOX_WEBHOOK_WINDOW_CLOSED" }, { status: 503 });
    if (invoice.provider_id !== provider) throw new Error("PAYMENT_PROVIDER_SCOPE_INVALID");
    const observation = await configuredTestAdapter(provider).verifyWebhook(input, invoice);
    const result = await recordVerifiedTestObservation(invoice, observation, "webhook");
    return NextResponse.json({ mode: "test", result });
  } catch (error) {
    const unavailable = error instanceof Error && ["PAYMENT_PROVIDER_UNAVAILABLE", "PAYMENT_INVOICE_UNAVAILABLE", "PAYMENT_RECORD_REJECTED"].includes(error.message);
    return NextResponse.json({ error: unavailable ? "PAYMENT_PROCESSING_UNAVAILABLE" : "PAYMENT_EVIDENCE_REJECTED" }, { status: unavailable ? 503 : 400 });
  }
}
