// Аналитика вакансии для работодателя: сравнение с рынком и подсказки по воронке.
// Чистые функции — без обращений к базе.
import type { SalaryBenchmark } from "@/lib/salary";
import { plural } from "@/lib/vacancies";

export type Insight = { tone: "good" | "warn" | "info"; title: string; text: string };

export type InsightInput = {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  direction: string | null;
  level: string | null;
  views: number;
  applications: { status: string; created_at: string }[];
  matchScores: number[];
  competitors: number | null;
};

const k = (n: number) => `${Math.round(n / 1000)} тыс. ₽`;

/** Строка справочника для вакансии: тот же уровень, иначе по всем уровням направления. */
export function benchmarkFor(direction: string | null, level: string | null, rows: SalaryBenchmark[]): SalaryBenchmark | null {
  if (!direction) return null;
  return (level && rows.find(b => !b.all_levels && b.direction === direction && b.level === level))
    || rows.find(b => b.all_levels && b.direction === direction) || null;
}

export function vacancyInsights(v: InsightInput, bench: SalaryBenchmark | null, now: number): Insight[] {
  const out: Insight[] = [];
  const rub = !v.salary_currency || v.salary_currency === "RUB";

  // Зарплата против рынка (по рублёвым вакансиям FastCV того же направления и уровня)
  if (bench && rub) {
    const market = `${k(bench.p25)} – ${k(bench.p75)}`;
    const top = v.salary_max ?? v.salary_min;
    const bottom = v.salary_min ?? v.salary_max;
    if (!top || !bottom) {
      out.push({ tone: "warn", title: "Зарплата не указана", text: `На рынке для такой позиции обычно ${market} (по ${bench.sample} вакансиям). Вакансии с вилкой получают заметно больше откликов.` });
    } else if (top < bench.p25) {
      const gap = Math.round((1 - top / bench.p25) * 100);
      out.push({ tone: "warn", title: "Вилка ниже рынка", text: `Верх вашей вилки на ${gap}% ниже нижней границы рынка (${market}). Проверьте сумму — или ждите меньше откликов.` });
    } else if (bottom > bench.p75) {
      out.push({ tone: "good", title: "Вилка выше рынка", text: `Обычно ${market} — ваша зарплата сильный аргумент. Вынесите её в начало описания.` });
    } else {
      out.push({ tone: "good", title: "Зарплата в рынке", text: `Рынок для такой позиции: ${market} (по ${bench.sample} вакансиям).` });
    }
  }

  // Конверсия просмотров в отклики
  const count = v.applications.length;
  if (v.views >= 30) {
    const rate = (count / v.views) * 100;
    if (rate < 3) {
      out.push({ tone: "warn", title: "Мало откликов на просмотры", text: `Откликнулись ${rate.toFixed(1).replace(".", ",")}% посмотревших. Обычно помогают вилка, понятные задачи в первых строках и удалёнка или гибрид.` });
    } else if (rate >= 10) {
      out.push({ tone: "good", title: "Хорошая конверсия", text: `Откликаются ${Math.round(rate)}% посмотревших — вакансия цепляет.` });
    }
  }

  // Насколько откликнувшиеся подходят
  if (v.matchScores.length >= 5) {
    const avg = Math.round(v.matchScores.reduce((s, x) => s + x, 0) / v.matchScores.length);
    if (avg < 45) {
      out.push({ tone: "info", title: "Кандидаты подходят частично", text: `Среднее совпадение откликов — ${avg}%. Возможно, требования слишком узкие или стек в вакансии описан неточно.` });
    }
  }

  // Ответы кандидатам
  const waiting = v.applications.filter(a => (a.status === "new" || a.status === "viewed") && now - Date.parse(a.created_at) > 3 * 864e5).length;
  if (waiting) {
    out.push({ tone: "warn", title: "Кандидаты ждут ответа", text: `${waiting} ${plural(waiting, ["кандидат ждёт", "кандидата ждут", "кандидатов ждут"])} дольше 3 дней. Скорость ответа видна в рейтинге компании.` });
  }

  // Конкуренция за кандидатов
  if (v.competitors !== null && v.competitors > 0) {
    out.push({ tone: "info", title: "Конкуренция", text: `За месяц на FastCV опубликовано ещё ${v.competitors} ${plural(v.competitors, ["похожая вакансия", "похожие вакансии", "похожих вакансий"])} того же направления и уровня.` });
  }
  return out;
}
