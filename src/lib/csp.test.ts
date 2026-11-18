// contentSecurityPolicy: nonce в script-src, свой сервер Supabase (infra/ru-migration) в connect-src.
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, createNonce } from "./csp";

function directive(csp: string, name: string): string {
  return csp.split("; ").find(d => d.startsWith(`${name} `)) ?? "";
}

afterEach(() => vi.unstubAllEnvs());

describe("contentSecurityPolicy", () => {
  it("пускает встроенные скрипты только с nonce", () => {
    const script = directive(contentSecurityPolicy("abc"), "script-src");
    expect(script).toContain("'nonce-abc'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("облачный Supabase покрыт *.supabase.co, отдельный адрес не добавляется", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    expect(directive(contentSecurityPolicy("n"), "connect-src")).toBe(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    );
  });

  it("разрешает свой сервер Supabase для fetch и realtime", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.fastcv.ru:8443");
    const connect = directive(contentSecurityPolicy("n"), "connect-src");
    expect(connect).toContain(" https://db.fastcv.ru:8443");
    expect(connect).toContain(" wss://db.fastcv.ru:8443");
  });

  it("без адреса Supabase политика собирается", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(directive(contentSecurityPolicy("n"), "connect-src")).toBe(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    );
  });
});

describe("createNonce", () => {
  it("каждый раз новый", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
