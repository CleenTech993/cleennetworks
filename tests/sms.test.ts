import { describe, expect, it } from "vitest";
import { buildSmsRequest, parseSmsResponse, toE164 } from "../src/lib/sms.server";

describe("phone numbers for SMS", () => {
  it("converts local and international formats", () => {
    for (const n of ["0712345678", "+254712345678", "254712345678", "712345678", "0712 345 678"])
      expect(toE164(n)).toBe("+254712345678");
  });
  it("rejects things that aren't numbers", () => {
    for (const bad of ["", "hello", "123", "0712345678; rm -rf"]) expect(toE164(bad)).toBeNull();
  });
});

describe("Africa's Talking request", () => {
  const cfg = { username: "acme", apiKey: "KEY" };
  it("targets the live API with the key in a header, not the body", () => {
    const r = buildSmsRequest(cfg, ["+254712345678", "+254722000111"], "hello");
    expect(r.url).toBe("https://api.africastalking.com/version1/messaging");
    expect((r.init.headers as Record<string, string>).apiKey).toBe("KEY");
    expect(r.init.body).not.toContain("KEY");
    const body = new URLSearchParams(r.init.body);
    expect(body.get("username")).toBe("acme");
    expect(body.get("to")).toBe("+254712345678,+254722000111");
    expect(body.get("message")).toBe("hello");
    expect(body.has("from")).toBe(false);
  });
  it("uses the sandbox and a sender id when configured", () => {
    const r = buildSmsRequest(
      { ...cfg, sandbox: true, senderId: "NETGRID" },
      ["+254712345678"],
      "x",
    );
    expect(r.url).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    expect(new URLSearchParams(r.init.body).get("from")).toBe("NETGRID");
  });
  it("caps very long messages", () => {
    const body = new URLSearchParams(
      buildSmsRequest(cfg, ["+254712345678"], "a".repeat(1000)).init.body,
    );
    expect(body.get("message")!.length).toBe(320);
  });
});

describe("Africa's Talking response", () => {
  const rec = (statusCode: number, status: string) => ({
    SMSMessageData: { Message: "Sent to 1/1", Recipients: [{ statusCode, status }] },
  });
  it("treats processed / sent / queued as success", () => {
    for (const c of [100, 101, 102]) expect(parseSmsResponse(rec(c, "Success")).ok).toBe(true);
  });
  it("reports the provider's reason on failure", () => {
    expect(parseSmsResponse(rec(403, "InvalidPhoneNumber"))).toEqual({
      ok: false,
      error: "InvalidPhoneNumber",
    });
    expect(
      parseSmsResponse({ SMSMessageData: { Message: "InsufficientBalance", Recipients: [] } }),
    ).toEqual({ ok: false, error: "InsufficientBalance" });
  });
  it("copes with unexpected bodies", () => {
    expect(parseSmsResponse(null).ok).toBe(false);
    expect(parseSmsResponse({}).ok).toBe(false);
  });
});
