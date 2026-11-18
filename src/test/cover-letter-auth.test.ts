import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

// Письмо генерируется только по сессии из cookies: заголовок Authorization: Bearer не даёт входа.

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => client.current }));

// Клиент Supabase по токену из заголовка: если маршрут его создаст, «вход» по Bearer удастся
const tokenClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", async importOriginal => ({
  ...(await importOriginal<object>()),
  createClient: tokenClient,
}));

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test");
  vi.stubGlobal("fetch", vi.fn());
  tokenClient.mockReset();
  tokenClient.mockReturnValue(fakeSupabase({ user: { id: "bearer-user" } }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cover-letter auth", () => {
  it("rejects a Bearer token without a cookie session", async () => {
    const cookieSession = fakeSupabase({ user: null });
    client.current = cookieSession;
    const { POST } = await import("@/app/api/cover-letter/route");
    const response: Response = await POST(new Request("http://localhost/api/cover-letter", {
      method: "POST",
      headers: { Authorization: "Bearer stolen-or-stale-token", "Content-Type": "application/json" },
      body: JSON.stringify({ vacancyId: ID }),
    }));

    expect(response.status).toBe(401);
    expect(tokenClient).not.toHaveBeenCalled();
    expect(cookieSession.rpcCalls).toHaveLength(0);
  });
});
