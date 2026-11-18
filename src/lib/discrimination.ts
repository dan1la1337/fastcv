// Дискриминационные требования в тексте вакансии: возраст, пол, национальность (ст. 3 и 64 ТК РФ,
// ст. 13.11.1 КоАП РФ) и гражданство. Правила — в discrimination-rules.json в корне репозитория,
// их же читает сборщик вакансий. Найденные флаги пишутся в vacancies.discrimination_flags.
// Флаги с block: true скрывают вакансию из публичной ленты (политика RLS в базе),
// гражданство только помечается: для части работ его требует закон.

import rules from "../../discrimination-rules.json";

type RuleFile = {
  flags: Record<string, {
    label: string;
    block: boolean;
    law: string;
    patterns: string[];
    not_after?: { pattern: string; window: number };
  }>;
};

export type DiscriminationFlag = keyof typeof rules.flags;

export interface DiscriminationFinding {
  flag: DiscriminationFlag;
  label: string;
  /** Скрывает вакансию из ленты. */
  block: boolean;
  law: string;
  /** Фрагмент текста, на котором сработало правило. */
  match: string;
}

const FILE: RuleFile = rules;

const COMPILED = Object.entries(FILE.flags).map(([flag, rule]) => ({
  flag: flag as DiscriminationFlag,
  rule,
  patterns: rule.patterns.map(p => new RegExp(p, "giu")),
  notAfter: rule.not_after ? { pattern: new RegExp(rule.not_after.pattern, "iu"), window: rule.not_after.window } : null,
}));

/** Все флаги из правил, по порядку файла. */
export const DISCRIMINATION_FLAGS = COMPILED.map(c => c.flag);

/** Флаги, которые скрывают вакансию из ленты. Тот же список — в политике vacancies_hide_discriminatory. */
export const BLOCKING_FLAGS = COMPILED.filter(c => c.rule.block).map(c => c.flag);

/** Первое срабатывание каждого флага в тексте. */
export function findDiscrimination(text: string | null | undefined): DiscriminationFinding[] {
  const source = text ?? "";
  const found: DiscriminationFinding[] = [];
  for (const { flag, rule, patterns, notAfter } of COMPILED) {
    const match = patterns
      .flatMap(p => [...source.matchAll(p)])
      .find(m => !notAfter || !notAfter.pattern.test(source.slice(Math.max(0, m.index - notAfter.window), m.index)));
    if (match) found.push({ flag, label: rule.label, block: rule.block, law: rule.law, match: match[0].trim() });
  }
  return found;
}

/** Значение для vacancies.discrimination_flags. */
export const discriminationFlags = (text: string | null | undefined): DiscriminationFlag[] =>
  findDiscrimination(text).map(f => f.flag);

/** Скроет ли база вакансию с такими флагами из ленты. */
export const isBlocked = (flags: readonly string[]) => flags.some(f => (BLOCKING_FLAGS as string[]).includes(f));
