import { describe, expect, it, vi } from "vitest";

// screening.ts и matching.ts тянут клиент Supabase; чистой логике кабинета он не нужен
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  EMPTY_FORM, REJECT_REASONS, bulkRejections, formWithDraft, sortApplications, vacancyFields, vacancyFunnel, type Application,
} from "@/lib/employer";
import { rejectAll } from "@/lib/bulk-reject";
import type { Match } from "@/lib/matching";
import type { Screening } from "@/lib/screening";
import type { VacancyDraft } from "@/lib/vacancy-draft";

const app = (id: string, title: string, status = "new"): Application => ({
  id, status, hr_message: null, cover_letter: null, created_at: "2026-11-01T00:00:00Z", blitz_answers: [], blitz_summary: null,
  vacancies: { id: `v-${title}`, title, employer_id: "e" }, profiles: null, conversations: null,
});

describe("bulkRejections", () => {
  const apps = [app("1", "Backend"), app("2", "Frontend", "viewed"), app("3", "Backend"), app("4", "Backend", "rejected")];

  it("группирует выбранные ждущие отклики по вакансии, отвеченные пропускает", () => {
    const groups = bulkRejections(apps, new Set(["1", "2", "3", "4"]), null);
    expect(groups.map(g => g.ids)).toEqual([["1", "3"], ["2"]]);
    expect(groups[0].message).toContain("«Backend»");
    expect(groups[1].message).toContain("«Frontend»");
  });

  it("причина дописывается к письму", () => {
    const [group] = bulkRejections(apps, new Set(["2"]), REJECT_REASONS[1].label);
    expect(group.message.endsWith(REJECT_REASONS[1].text)).toBe(true);
  });

  it("ничего не выбрано — ничего не отправляем", () => {
    expect(bulkRejections(apps, new Set(), null)).toEqual([]);
  });

  it("письма для rejectAll: ошибка одной вакансии не останавливает остальные (#189)", async () => {
    const letters = bulkRejections(apps, new Set(["1", "2", "3"]), null);
    const result = await rejectAll(letters, async (ids, message) =>
      message.includes("«Backend»") ? { updated: [], error: "timeout" } : { updated: ids, error: null });
    expect(Object.keys(result.done)).toEqual(["2"]);
    expect(result.failed).toEqual([{ ids: ["1", "3"], error: "timeout" }]);
  });
});

describe("vacancyFields", () => {
  it("отмечает дискриминационные требования в названии и описании", () => {
    const result = vacancyFields({ ...EMPTY_FORM, title: "Менеджер", description: "Ищем кандидата до 35 лет. Только мужчины" }, null);
    expect("fields" in result && result.fields.discrimination_flags).toEqual(["age", "sex"]);
  });

  it("«от» больше «до» — ошибка", () => {
    expect(vacancyFields({ ...EMPTY_FORM, salaryMin: "300", salaryMax: "200" }, null)).toEqual({ error: "Зарплата «от» больше, чем «до»." });
  });

  it("чистит поля: пробелы, повторы стека, пустые вопросы; валюта только с зарплатой", () => {
    const result = vacancyFields({
      ...EMPTY_FORM, title: "  Go  ", stack: "Go, Postgres, Go, ,", questions: [" Опыт? ", "", ""], city: " ",
    }, "ООО");
    expect(result).toEqual({
      fields: {
        title: "Go", description: "", salary_min: null, salary_max: null, salary_currency: null, city: null, is_remote: false,
        company_name: "ООО", stack: ["Go", "Postgres"], blitz_questions: ["Опыт?"], discrimination_flags: [],
      },
    });
  });
});

describe("formWithDraft", () => {
  it("пустые поля черновика не затирают введённое", () => {
    const prev = { ...EMPTY_FORM, salaryMin: "100", city: "Москва", stack: "Go" };
    const draft = { title: "T", description: "D", salary_min: null, salary_max: 200, city: null, is_remote: false, stack: [] } as unknown as VacancyDraft;
    expect(formWithDraft(prev, draft)).toMatchObject({ title: "T", description: "D", salaryMin: "100", salaryMax: "200", city: "Москва", stack: "Go" });
  });
});

describe("sortApplications", () => {
  const apps = [app("a", "X"), app("b", "X"), app("c", "X")];
  const matches = { a: { score: 10 }, b: { score: 90 } } as unknown as Record<string, Match>;
  const screenings = { a: { fit: "strong" }, c: { fit: "strong" } } as unknown as Record<string, Screening>;

  it("по совпадению: без оценки — в конце", () => {
    expect(sortApplications(apps, "match", matches, screenings).map(a => a.id)).toEqual(["b", "a", "c"]);
  });

  it("по вердикту ИИ, при равном — по совпадению", () => {
    expect(sortApplications(apps, "ai", matches, screenings).map(a => a.id)).toEqual(["a", "c", "b"]);
  });

  it("новые — как пришли", () => {
    expect(sortApplications(apps, "new", matches, screenings)).toBe(apps);
  });
});

describe("vacancyFunnel", () => {
  it("считает отклики и приглашения, top — не меньше 1", () => {
    const { steps, top } = vacancyFunnel(0, [{ status: "interview_scheduled" }, { status: "new" }]);
    expect(steps.map(s => s.value)).toEqual([0, 2, 1]);
    expect(top).toBe(2);
    expect(vacancyFunnel(0, []).top).toBe(1);
  });
});
