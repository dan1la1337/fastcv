import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeAiQuota, type QuotaClient } from "@/lib/ai-quota";

const client = (result: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(async () => result);
  return { rpc, client: { rpc } as QuotaClient };
};
const quota = { kind: "cover_letter", max: 10, label: "писем" };

afterEach(() => vi.restoreAllMocks());

describe("consumeAiQuota", () => {
  it("asks the database for one call in an hour window and lets the request through", async () => {
    const { rpc, client: c } = client({ data: { allowed: true }, error: null });
    expect(await consumeAiQuota(c, quota)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("consume_ai_quota", { quota_kind: "cover_letter", max_calls: 10, window_seconds: 3600 });
  });

  it("answers 429 with Retry-After and minutes left when the limit is used up", async () => {
    const { client: c } = client({ data: { allowed: false, retry_after: 125 }, error: null });
    const response = await consumeAiQuota(c, quota);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("125");
    expect(await response?.json()).toEqual({ error: "Лимит: 10 писем в час. Попробуйте через 3 мин." });
  });

  it("assumes a full hour and at least one minute", async () => {
    const hour = await consumeAiQuota(client({ data: { allowed: false }, error: null }).client, quota);
    expect(hour?.headers.get("Retry-After")).toBe("3600");
    expect((await hour?.json()).error).toContain("через 60 мин");
    const soon = await consumeAiQuota(client({ data: { allowed: false, retry_after: 5 }, error: null }).client, quota);
    expect((await soon?.json()).error).toContain("через 1 мин");
  });

  it.each([[null], [{}], ["yes"]])("treats an unexpected answer %j as not allowed", async data => {
    expect((await consumeAiQuota(client({ data, error: null }).client, quota))?.status).toBe(429);
  });

  it("answers 503 when the counter is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await consumeAiQuota(client({ data: null, error: { message: "db down" } }).client, quota);
    expect(response?.status).toBe(503);
    expect(console.error).toHaveBeenCalledWith("AI quota check failed", "cover_letter", "db down");
  });
});
