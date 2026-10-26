import { describe, expect, it, vi } from "vitest";
import { handlePrivateBetaRelay, privateBetaRelaySignature } from "../../supabase/functions/polat-private-beta-ingress/relay";

const config = { webhookSecret: "offline_webhook_".padEnd(48, "x"), relaySecret: "offline_relay_".padEnd(48, "y"), vercelBypass: "offline_project_only_fixture" };
const inbound = (body = '{"update_id":1}', headers: Record<string, string> = {}) => new Request("https://fixture.invalid/ingress?target=https://attacker.invalid", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret, ...headers }, body });
describe("private beta fixed, authenticated ingress (offline)", () => {
  it("forwards only to the fixed staging webhook with a separate payload-bound MAC", async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ raw: "must not reflect" }));
    const body = '{"update_id":1}', time = 1793000000000;
    const r = await handlePrivateBetaRelay(inbound(body), config, network, time);
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true });
    expect(network).toHaveBeenCalledTimes(1);
    const [url, options] = network.mock.calls[0]!;
    expect(url).toBe("https://gold-revenue-os-staging.vercel.app/api/webhooks/private-beta/telegram");
    expect(options?.redirect).toBe("error"); expect(options?.body).toBe(body);
    const headers = new Headers(options?.headers);
    expect(headers.get("x-polat-uat-signature")).toBe(await privateBetaRelaySignature(body, "1793000000", config.relaySecret));
    expect(headers.get("x-vercel-protection-bypass")).toBe(config.vercelBypass);
    expect(headers.has("authorization")).toBe(false);
  });
  it("denies missing/wrong secret without any upstream call", async () => {
    const network = vi.fn<typeof fetch>();
    for (const token of ["", "wrong"]) expect((await handlePrivateBetaRelay(inbound("{}", { "x-telegram-bot-api-secret-token": token }), config, network)).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed input, bad type and absent configuration", async () => {
    const network = vi.fn<typeof fetch>();
    expect((await handlePrivateBetaRelay(inbound("x".repeat(65537)), config, network)).status).toBe(413);
    expect((await handlePrivateBetaRelay(inbound("{}", { "content-type": "text/plain" }), config, network)).status).toBe(415);
    expect((await handlePrivateBetaRelay(inbound(), { ...config, relaySecret: "" }, network)).status).toBe(503);
    expect(network).not.toHaveBeenCalled();
  });
  it("never retries or reflects an unknown/failed provider operation", async () => {
    for (const result of ["throw", "failed"] as const) {
      const network = result === "throw" ? vi.fn<typeof fetch>().mockRejectedValue(Error(config.vercelBypass)) : vi.fn<typeof fetch>().mockResolvedValue(new Response(config.vercelBypass, { status: 500 }));
      const r = await handlePrivateBetaRelay(inbound(), config, network);
      expect(r.status).toBe(503); expect(await r.text()).not.toContain(config.vercelBypass); expect(network).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects GET and binds MAC to body and timestamp", async () => {
    const network = vi.fn<typeof fetch>();
    expect((await handlePrivateBetaRelay(new Request("https://fixture.invalid"), config, network)).status).toBe(405);
    expect(await privateBetaRelaySignature("a", "1", config.relaySecret)).not.toBe(await privateBetaRelaySignature("b", "1", config.relaySecret));
    expect(await privateBetaRelaySignature("a", "1", config.relaySecret)).not.toBe(await privateBetaRelaySignature("a", "2", config.relaySecret));
    expect(network).not.toHaveBeenCalled();
  });
});
