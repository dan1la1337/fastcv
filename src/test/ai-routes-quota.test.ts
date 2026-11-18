import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

// Каждый ИИ-маршрут проверяет лимит до запроса к модели: при исчерпанном лимите — 429, модель не зовётся.

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => client.current }));

const ID = "11111111-2222-4333-8444-555555555555";
const vacancy = { id: "v1", title: "Python-разработчик", description: "Django", stack: ["Python"], level: "middle", city: "Москва", work_format: "remote", company_name: "Acme", employer_id: "user-1", blitz_questions: [] };
const application = { id: ID, status: "rejected", cover_letter: "Письмо", hr_message: null, candidate_id: "c1", blitz_answers: [{ q: "Опыт?", a: "Пять лет" }], blitz_summary: null, vacancies: vacancy };

const cases = [
  { route: "screen-application", kind: "screening", body: { applicationId: ID } },
  { route: "rejection-analysis", kind: "rejection_analysis", body: { applicationId: ID } },
  { route: "blitz-summary", kind: "blitz_summary", body: { applicationId: ID } },
  { route: "cover-letter", kind: "cover_letter", body: { vacancyId: ID } },
  { route: "resume-autofill", kind: "resume_parse", body: {}, profile: { role: "candidate", resume_path: "c1/cv.pdf" } },
  { route: "vacancy-draft", kind: "vacancy_draft", body: { notes: "Ищем Python-разработчика в команду платежей" }, profile: { role: "employer" } },
  { route: "interview-practice", kind: "practice_questions", body: { action: "questions", vacancyId: ID } },
  { route: "interview-practice", kind: "practice_grade", body: { action: "grade", vacancyId: ID, question: "Что такое GIL?", answer: "Глобальная блокировка" } },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(cases)("$route ($kind)", ({ route, kind, body, profile }) => {
  it("stops with 429 before calling the model when the limit is used up", async () => {
    const supabase = fakeSupabase({
      tables: { applications: application, vacancies: vacancy, profiles: profile ?? { name: "Иван", skills: [] } },
      rpc: { consume_ai_quota: { allowed: false, retry_after: 600 } },
    });
    client.current = supabase;
    const { POST } = await import(`@/app/api/${route}/route`);
    const response: Response = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect((await response.json()).error).toMatch(/^Лимит: \d+ .+ в час\. Попробуйте через 10 мин\.$/);
    expect(supabase.rpcCalls.find(c => c.name === "consume_ai_quota")?.args).toMatchObject({ quota_kind: kind, window_seconds: 3600 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
