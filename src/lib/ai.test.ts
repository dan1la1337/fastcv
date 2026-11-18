import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import aiModels from "../../ai-models.json";
import { aiConfigured, aiSettings, aiText, createAiClient, type AiProvider, type AiRequest, type ModelResult } from "@/lib/ai";
import { geminiProvider, yandexProvider } from "@/lib/ai-providers";
import { NAME_TOKEN } from "@/lib/redact";

/** Поддельный провайдер: ответы по моделям, запоминает запросы. */
function mockProvider(answers: Record<string, ModelResult | Error>) {
  const calls: { model: string; request: AiRequest }[] = [];
  const provider: AiProvider = {
    id: "mock",
    async generate(model, request) {
      calls.push({ model, request });
      const answer = answers[model] ?? { ok: false, tryNext: true };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { provider, calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ai-models.json", () => {
  it("lists a default provider and a non-empty model order for each provider", () => {
    expect(Object.keys(aiModels.providers)).toContain(aiModels.provider);
    for (const config of Object.values(aiModels.providers)) {
      expect(config.models.length).toBeGreaterThan(0);
      expect(config.api_key_env).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("createAiClient", () => {
  it("falls back to the next model when one is overloaded, times out or returns junk", async () => {
    const { provider, calls } = mockProvider({
      a: { ok: false, tryNext: true },
      b: new Error("timeout"),
      c: { ok: true, text: "   " },
      d: { ok: true, text: "Готово" },
    });
    const text = await createAiClient(provider, ["a", "b", "c", "d", "e"])("инструкция", "данные");
    expect(text).toBe("Готово");
    expect(calls.map(c => c.model)).toEqual(["a", "b", "c", "d"]);
  });

  it("stops on a request error that other models will not fix", async () => {
    const { provider, calls } = mockProvider({ a: { ok: false, tryNext: false }, b: { ok: true, text: "x" } });
    expect(await createAiClient(provider, ["a", "b"])("i", "d")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("returns null when no model answered", async () => {
    const { provider } = mockProvider({});
    expect(await createAiClient(provider, ["a", "b"])("i", "d")).toBeNull();
  });

  it("redacts the input, including the known name, before any provider sees it", async () => {
    const { provider, calls } = mockProvider({ a: { ok: true, text: "ok" } });
    await createAiClient(provider, ["a"])("i", "Иван Петров, +7 999 123-45-67, ivan@mail.ru", { names: ["Иван Петров"] });
    expect(calls[0].request.input).toBe(`${NAME_TOKEN}, [телефон], [email]`);
    expect(calls[0].request.instruction).toBe("i");
  });

  it("for JSON skips invalid answers and strips think blocks and code fences", async () => {
    const { provider, calls } = mockProvider({
      a: { ok: true, text: "{битый" },
      b: { ok: true, text: '<think>рассуждаю</think>\n```json\n{"fit": "strong"}\n```' },
    });
    const text = await createAiClient(provider, ["a", "b"])("i", "d", { json: true });
    expect(text).toBe('{"fit": "strong"}');
    expect(calls.map(c => c.model)).toEqual(["a", "b"]);
  });

  it("passes defaults and options to the provider", async () => {
    const { provider, calls } = mockProvider({ a: { ok: true, text: "{}" } });
    const client = createAiClient(provider, ["a"]);
    await client("i", "d");
    expect(calls[0].request).toMatchObject({ temperature: 0.3, timeoutMs: 20_000, json: false });
    await client("i", "d", { temperature: 0, maxOutputTokens: 50, schema: { type: "OBJECT" }, timeoutMs: 5 });
    expect(calls[1].request).toMatchObject({ temperature: 0, maxOutputTokens: 50, json: true, schema: { type: "OBJECT" }, timeoutMs: 5 });
  });
});

describe("aiSettings: provider is a config change", () => {
  it("uses the default provider from ai-models.json", () => {
    const settings = aiSettings({ GEMINI_API_KEY: "g" });
    expect(settings?.provider.id).toBe("gemini");
    expect(settings?.models).toEqual(aiModels.providers.gemini.models);
  });

  it("switches provider with AI_PROVIDER and models with AI_MODELS", () => {
    const env = { AI_PROVIDER: "yandex", YANDEX_API_KEY: "y", YANDEX_FOLDER_ID: "b1g" };
    expect(aiSettings(env)?.provider.id).toBe("yandex");
    expect(aiSettings(env)?.models).toEqual(aiModels.providers.yandex.models);
    expect(aiSettings({ ...env, AI_MODELS: " m1 , m2 ," })?.models).toEqual(["m1", "m2"]);
  });

  it("is not configured without the provider's keys or with an unknown provider", () => {
    expect(aiConfigured({})).toBe(false);
    expect(aiConfigured({ AI_PROVIDER: "yandex", YANDEX_API_KEY: "y" })).toBe(false);
    expect(aiConfigured({ AI_PROVIDER: "openai", GEMINI_API_KEY: "g" })).toBe(false);
  });

  it("reads another models file", () => {
    const file = { provider: "yandex", providers: { yandex: { api_key_env: "K", folder_env: "F", models: ["only"] } } };
    expect(aiSettings({ K: "k", F: "f" }, file)?.models).toEqual(["only"]);
  });
});

describe("providers over HTTP", () => {
  const request: AiRequest = { instruction: "сис", input: "данные", temperature: 0.2, maxOutputTokens: 100, json: true, schema: { type: "OBJECT" }, timeoutMs: 1000 };
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("gemini: key in header, instruction separate from data, schema passed", async () => {
    const fetchMock = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await geminiProvider("key").generate("gemini-x", request)).toEqual({ ok: true, text: "{}" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    expect(url).not.toContain("key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("key");
    const body = JSON.parse(String(init.body));
    expect(body.system_instruction.parts[0].text).toBe("сис");
    expect(body.contents[0].parts[0].text).toBe("данные");
    expect(body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 100, responseMimeType: "application/json", responseSchema: { type: "OBJECT" } });
  });

  it("yandex: OpenAI-compatible chat with folder model URI and schema in the instruction", async () => {
    const fetchMock = vi.fn(async () => ok({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await yandexProvider("key", "b1g").generate("yandexgpt/latest", request)).toEqual({ ok: true, text: "{}" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.api.cloud.yandex.net/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Api-Key key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt://b1g/yandexgpt/latest");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain('Схема ответа: {"type":"OBJECT"}');
    expect(body.messages[1]).toEqual({ role: "user", content: "данные" });
    expect(body.max_tokens).toBe(100);
  });

  it.each([[404, true], [429, true], [503, true], [400, false], [403, false]])("HTTP %i → tryNext %s", async (status, tryNext) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status })));
    expect(await geminiProvider("k").generate("m", request)).toEqual({ ok: false, tryNext });
  });

  it("aiText goes to the provider chosen by env", async () => {
    vi.stubEnv("AI_PROVIDER", "yandex");
    vi.stubEnv("YANDEX_API_KEY", "y");
    vi.stubEnv("YANDEX_FOLDER_ID", "b1g");
    vi.stubEnv("AI_MODELS", "qwen");
    const fetchMock = vi.fn(async () => ok({ choices: [{ message: { content: "Привет" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await aiText("i", "d")).toBe("Привет");
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain("llm.api.cloud.yandex.net");
  });
});
