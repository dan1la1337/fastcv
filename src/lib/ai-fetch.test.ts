// aiFetch: с AI_HTTPS_PROXY запросы к ИИ и к Telegram идут через прокси, без переменной — напрямую.
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { aiFetch } from "@/lib/ai-fetch";
import { geminiProvider } from "@/lib/ai-providers";
import { telegram } from "@/lib/telegram";

const listen = (server: http.Server) =>
  new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

// upstream отвечает на любой запрос; прокси туннелирует CONNECT в upstream и запоминает, куда просили
const upstream = http.createServer((req, res) => res.end(`ok ${req.url}`));
const proxy = http.createServer((req, res) => { seen.push(req.url ?? ""); res.end("ok via proxy"); });
const seen: string[] = [];
let upstreamPort = 0;
let proxyPort = 0;

beforeAll(async () => {
  upstreamPort = await listen(upstream);
  proxy.on("connect", (req, socket, head) => {
    seen.push(`CONNECT ${req.url}`);
    // HTTPS к настоящим хостам не поднять: отвечаем отказом, важен сам факт CONNECT через прокси
    if (!req.url?.startsWith("127.0.0.1")) { socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); return; }
    const conn = net.connect(upstreamPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      conn.write(head);
      conn.pipe(socket);
      socket.pipe(conn);
    });
  });
  proxyPort = await listen(proxy);
});
afterEach(() => { seen.length = 0; delete process.env.AI_HTTPS_PROXY; });
afterAll(() => { upstream.close(); proxy.close(); });

describe("aiFetch", () => {
  it("без AI_HTTPS_PROXY — напрямую", async () => {
    const direct = await aiFetch(`http://127.0.0.1:${upstreamPort}/direct`, { method: "POST", body: "{}" });
    expect(await direct.text()).toBe("ok /direct");
    expect(seen).toEqual([]);
  });

  it("с AI_HTTPS_PROXY — через прокси", async () => {
    process.env.AI_HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
    const viaProxy = await aiFetch("http://ai.example.invalid/v1beta/models/x:generateContent", { method: "POST", body: "{}" });
    expect(viaProxy.status).toBe(200);
    expect(seen.some(s => s.includes("ai.example.invalid"))).toBe(true);
  });

  it("провайдер Gemini и Telegram Bot API ходят через AI_HTTPS_PROXY", async () => {
    process.env.AI_HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
    // Ошибку сети провайдер отдаёт наверх: перебор моделей в src/lib/ai.ts сам её ловит
    await expect(geminiProvider("key").generate("m", { instruction: "i", input: "x", temperature: 0, timeoutMs: 5_000 })).rejects.toThrow();
    await expect(telegram("token", "getMe")).rejects.toThrow();
    expect(seen).toEqual(["CONNECT generativelanguage.googleapis.com:443", "CONNECT api.telegram.org:443"]);
  });
});
