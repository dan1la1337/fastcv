import { Loader2, Sparkles } from "lucide-react";
import type { SortBy } from "@/lib/employer";

/** Сортировка откликов и пакетный ИИ-разбор новых. */
export default function ApplicationsToolbar({ sortBy, setSortBy, unscreenedCount, batch, onScreenAll }: {
  sortBy: SortBy;
  setSortBy: (sortBy: SortBy) => void;
  /** Сколько ждущих откликов без вердикта ИИ. */
  unscreenedCount: number;
  /** Ход пакетного разбора; null — не идёт. */
  batch: { done: number; total: number } | null;
  onScreenAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Сортировка откликов" className="neu-in grid grid-cols-3 w-full sm:w-auto sm:inline-flex gap-1 p-1 text-xs sm:text-sm">
        {([["match", "По совпадению"], ["ai", "По вердикту ИИ"], ["new", "Сначала новые"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSortBy(id)} aria-pressed={sortBy === id}
            className={`lg min-w-0 px-1 sm:px-4 py-1.5 rounded-lg leading-tight transition-colors ${sortBy === id ? "lg lg-on" : "text-neutral-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>
      {unscreenedCount > 0 ? (
        <button onClick={onScreenAll} disabled={!!batch}
          className="lg inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-sm text-indigo-200 disabled:opacity-60">
          {batch ? <><Loader2 className="w-4 h-4 animate-spin" /> Разбираю {batch.done} из {batch.total}…</>
            : <><Sparkles className="w-4 h-4" /> ИИ-разбор новых откликов · {Math.min(unscreenedCount, 15)}</>}
        </button>
      ) : (
        <p className="text-xs text-neutral-500">Порядок зависит только от совпадения с вакансией — не от оплаты</p>
      )}
    </div>
  );
}
