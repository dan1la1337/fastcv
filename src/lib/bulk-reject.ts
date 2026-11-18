// Массовый отказ в кабинете работодателя (без обращений к базе).

/** Отклики одной вакансии и общий для них текст отказа. */
export type RejectGroup = { message: string; ids: string[] };
/** Обновить отклики; вернуть ID, которые база действительно обновила. */
export type RejectUpdate = (ids: string[], message: string) => Promise<{ updated: string[]; error: string | null }>;
export type RejectResult = { done: Record<string, string>; failed: { ids: string[]; error: string }[] };

const NOT_UPDATED = "отклик недоступен или уже изменён";

/** Отправить все группы. Ошибка в одной группе не останавливает остальные. */
export async function rejectAll(groups: RejectGroup[], update: RejectUpdate): Promise<RejectResult> {
  const result: RejectResult = { done: {}, failed: [] };
  for (const { message, ids } of groups) {
    let updated: string[] = [];
    let error: string | null;
    try {
      ({ updated, error } = await update(ids, message));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) {
      result.failed.push({ ids, error });
      continue;
    }
    const ok = new Set(updated);
    ids.filter(id => ok.has(id)).forEach(id => { result.done[id] = message; });
    const missing = ids.filter(id => !ok.has(id));
    if (missing.length) result.failed.push({ ids: missing, error: NOT_UPDATED });
  }
  return result;
}

/** Итог массового отказа для плашки над списком. */
export function rejectNotice(result: RejectResult): { kind: "ok" | "error"; text: string } {
  const sent = Object.keys(result.done).length;
  const failed = result.failed.reduce((n, f) => n + f.ids.length, 0);
  if (!failed) return { kind: "ok", text: `Отправлено отказов: ${sent}. Кандидаты увидят ответ в «Моих откликах» и в чате.` };
  const reasons = [...new Set(result.failed.map(f => f.error))].join("; ");
  return {
    kind: "error",
    text: `Отправлено отказов: ${sent} из ${sent + failed}. Не отправлено: ${failed} (${reasons}). Эти отклики остались выбранными — можно повторить.`,
  };
}
