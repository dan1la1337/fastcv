"use client";

import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { fetchMarks, setMark, type MarkKind } from "@/lib/marks";
import { hiddenIds, nextMark, withMarked } from "@/lib/feed-filters";
import { toast } from "@/components/Toaster";
import type { Vacancy } from "@/lib/vacancies";

/**
 * Избранное и скрытые: отметки пользователя на вакансиях.
 * Списки избранного и скрытых и hiddenRef принадлежат ленте: она же загружает их во вкладке «Избранное».
 */
export function useVacancyMarks({ userId, isCandidate, hiddenRef, setSavedList, setHiddenList }: {
  userId: string | undefined;
  isCandidate: boolean;
  /** id скрытых вакансий для запросов ленты. */
  hiddenRef: RefObject<string[]>;
  setSavedList: Dispatch<SetStateAction<Vacancy[]>>;
  setHiddenList: Dispatch<SetStateAction<Vacancy[]>>;
}) {
  const [marks, setMarks] = useState<Map<string, MarkKind>>(new Map());
  // Вакансии, отметка которых ещё сохраняется: второй клик до ответа базы мог обогнать первый
  const [pendingMarks, setPendingMarks] = useState<Set<string>>(new Set());

  // Отметки загружаем один раз после входа; дальше меняем локально вместе с базой
  useEffect(() => {
    if (!isCandidate) return;
    fetchMarks().then(found => {
      setMarks(found);
      hiddenRef.current = hiddenIds(found);
    }).catch(() => {});
  }, [isCandidate, hiddenRef]);

  async function toggleMark(item: Vacancy, kind: MarkKind) {
    if (!userId || pendingMarks.has(item.id)) return;
    setPendingMarks(prev => new Set(prev).add(item.id));
    const next = nextMark(marks, item.id, kind);
    const before = marks;
    const updated = new Map(marks);
    if (next) updated.set(item.id, next); else updated.delete(item.id);
    setMarks(updated);
    hiddenRef.current = hiddenIds(updated);
    setSavedList(prev => withMarked(prev, item, next === "saved"));
    setHiddenList(prev => withMarked(prev, item, next === "hidden"));
    try {
      await setMark(userId, item.id, next);
      if (next === "hidden") toast("Вакансия скрыта. Вернуть можно во вкладке «Избранное».", "info");
      if (next === "saved") toast("Добавлено в избранное.", "ok");
    } catch {
      setMarks(before);
      hiddenRef.current = hiddenIds(before);
      toast("Не удалось сохранить отметку. Попробуйте ещё раз.", "error");
    } finally {
      setPendingMarks(prev => { const rest = new Set(prev); rest.delete(item.id); return rest; });
    }
  }

  return { marks, pendingMarks, toggleMark };
}
