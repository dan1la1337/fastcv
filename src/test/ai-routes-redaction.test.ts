import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, geminiResponse } from "@/test/fake-supabase";

// Имя кандидата из профиля не должно уходить в Gemini ни в каком поле:
// письмо, ответы на вопросы, «о себе», ответ работодателя.

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => client.current }));

const APP_ID = "11111111-2222-4333-8444-555555555555";
const NAME = "Иван Петров";
const LEAKY = "Здравствуйте, меня зовут Иван Петров. Петрову интересна вакансия, телефон 999 123-45-67.";

const profile = {
  name: NAME,
  skills: ["Python", "Django"],
  description: `Я ${NAME}, пишу на Python пять лет`,
  pref_level: "middle",
  experience_years: 5,
  pref_city: "Москва",
};

let fetchMock: ReturnType<typeof vi.fn>;
const sentText = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).contents[0].parts[0].text).join("\n");

const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("screen-application", () => {
  it("sends the application to Gemini without the candidate's name", async () => {
    client.current = fakeSupabase({
      tables: {
        applications: {
          id: APP_ID,
          cover_letter: LEAKY,
          blitz_answers: [{ q: "Как вас зовут?", a: "Иван, коротко — Ваня Петров" }],
          candidate_id: "cand-1",
          vacancies: { id: "v1", title: "Python-разработчик", description: "Django", stack: ["Python"], level: "middle", city: "Москва", work_format: "remote", employer_id: "user-1" },
        },
        profiles: profile,
      },
      rpc: { consume_ai_quota: { allowed: true }, my_application_matches: [] },
    });
    fetchMock = vi.fn(async () => geminiResponse('{"fit":"strong","headline":"Подходит","pros":["Python"],"cons":[],"ask":"Про Django?"}'));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/screen-application/route");
    const response = await POST(post({ applicationId: APP_ID }));

    expect(response.status).toBe(200);
    const sent = sentText();
    expect(sent).toContain("Python");
    expect(sent).not.toMatch(/Иван|Петров/);
    expect(sent).not.toContain("999 123-45-67");
  });
});

describe("rejection-analysis", () => {
  it("sends the rejected application to Gemini without the candidate's name", async () => {
    client.current = fakeSupabase({
      tables: {
        applications: {
          id: APP_ID,
          status: "rejected",
          cover_letter: LEAKY,
          hr_message: "Иван, спасибо за отклик, но мы выбрали другого кандидата",
          blitz_answers: [],
          vacancies: { id: "v1", title: "Python-разработчик", description: "Django", stack: ["Python"], level: "senior", company_name: "Acme" },
        },
        profiles: profile,
      },
      rpc: { consume_ai_quota: { allowed: true }, my_vacancy_matches: [{ score: 60, matched: ["Python"], missing: ["Kafka"] }] },
    });
    fetchMock = vi.fn(async () => geminiResponse(
      '{"summary":"Не хватило опыта","reasons":["уровень"],"strengths":["Python"],"gaps":["Kafka"],"letter":"","next":["Kafka"]}',
    ));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/rejection-analysis/route");
    const response = await POST(post({ applicationId: APP_ID }));

    expect(response.status).toBe(200);
    const sent = sentText();
    expect(sent).toContain("Kafka");
    expect(sent).not.toMatch(/Иван|Петров/);
  });
});
