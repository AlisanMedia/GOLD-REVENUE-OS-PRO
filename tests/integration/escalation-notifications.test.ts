import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ManagerTelegramNotifier } from "../../apps/web/src/lib/escalations/notification-adapter";

const job = { id: "12000000-0000-4000-8000-000000000001", tenant_id: "12000000-0000-4000-8000-000000000002", case_id: "12000000-0000-4000-8000-000000000003", lease_token: "12000000-0000-4000-8000-000000000004", attempt: 1, chat_id: "12345", bot_id: "99999", severity: "HIGH" as const, category: "payment_dispute" as const, customer_id: null, waiting_seconds: 20 };
const binding = { tenantId: job.tenant_id, chatId: job.chat_id, botId: job.bot_id, botToken: "synthetic-not-a-token", appOrigin: "https://example.test" };
function transport(last: Response | Error) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ok: true, result: { id: 99999, is_bot: true } })).mockResolvedValueOnce(Response.json({ ok: true, result: { id: 12345, type: "private", username: "approved_manager" } })).mockImplementationOnce(async () => { if (last instanceof Error) throw last; return last; });
}
describe("Manager notification provider boundary (synthetic, not Telegram acceptance)", () => {
  it("requires exact tenant and destination before any network call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ManagerTelegramNotifier(binding, fetcher).send({ ...job, tenant_id: "12000000-0000-4000-8000-000000000099" })).rejects.toThrow("NOTIFICATION_SCOPE_DENIED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("records success only for an authenticated exact-chat message receipt", async () => {
    const fetcher = transport(Response.json({ ok: true, result: { message_id: 41, chat: { id: 12345 } } }));
    expect(await new ManagerTelegramNotifier(binding, fetcher).send(job)).toEqual({ result: "SENT", provider_status: 200, provider_message_id: "41" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const payload = JSON.parse(String(fetcher.mock.calls[2]![1]!.body));
    expect(payload.protect_content).toBe(true); expect(payload.text).not.toContain(binding.botToken);
    expect(payload.text).toContain("Öncelik: Yüksek"); expect(payload.text).toContain("Konu: Ödeme itirazı");
    expect(payload.parse_mode).toBeUndefined(); expect(payload.text.length).toBeLessThan(1000);
  });
  it("holds malformed or wrong-chat success as uncertain", async () => {
    for (const body of [{ ok: true }, { ok: true, result: { message_id: 41, chat: { id: 88888 } } }]) expect((await new ManagerTelegramNotifier(binding, transport(Response.json(body))).send(job)).result).toBe("UNCERTAIN");
  });
  it("retries only explicit 429 and bounds the delay", async () => {
    const r = await new ManagerTelegramNotifier(binding, transport(Response.json({ ok: false, parameters: { retry_after: 999 } }, { status: 429 }))).send(job);
    expect(r).toEqual({ result: "RETRY", provider_status: 429, retry_after: 300 });
  });
  it("never blindly retries send timeouts or 5xx", async () => {
    for (const result of [new Error("network"), Response.json({ ok: false }, { status: 503 })]) expect((await new ManagerTelegramNotifier(binding, transport(result)).send(job)).result).toBe("UNCERTAIN");
  });
  it("rejects wrong bot and public/channel destinations before send", async () => {
    const wrongBot = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, result: { id: 88888, is_bot: true } }));
    expect((await new ManagerTelegramNotifier(binding, wrongBot).send(job)).result).toBe("FAILED");expect(wrongBot).toHaveBeenCalledTimes(1);
    const channel = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ok: true, result: { id: 99999, is_bot: true } })).mockResolvedValueOnce(Response.json({ ok: true, result: { id: 12345, type: "channel" } }));
    expect((await new ManagerTelegramNotifier(binding, channel).send(job)).result).toBe("FAILED");expect(channel).toHaveBeenCalledTimes(2);
  });
  it("does not label failed preflight or 403 as notified", async () => {
    const preflight = vi.fn<typeof fetch>().mockRejectedValue(new Error("provider unavailable"));
    expect((await new ManagerTelegramNotifier(binding, preflight).send(job)).result).toBe("FAILED");
    expect((await new ManagerTelegramNotifier(binding, transport(Response.json({ ok: false }, { status: 403 }))).send(job)).result).toBe("FAILED");
  });
});
