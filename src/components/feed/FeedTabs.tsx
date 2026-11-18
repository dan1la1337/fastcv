import { Bookmark, Target } from "lucide-react";
import { AREAS, type Area } from "@/lib/vacancies";

export type FeedMode = "all" | "for-you" | "saved";

/** Переключатель раздела ленты: «Все разделы» и разделы из AREAS. */
export function AreaTabs({ area, chooseArea }: { area: Area | ""; chooseArea: (next: Area | "") => void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]" role="group" aria-label="Раздел ленты">
      {([["", "Все разделы", "Все"], ...AREAS.map(a => [a.id, a.label, a.short])] as [Area | "", string, string][]).map(([id, label, short]) => (
        <button
          key={id || "all"}
          onClick={() => chooseArea(id)}
          aria-pressed={area === id}
          className={`lg shrink-0 whitespace-nowrap px-4 py-2 rounded-full text-sm transition-colors ${
            area === id ? "lg lg-on" : "lg text-neutral-300"
          }`}
        >
          <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Вкладки кандидата: вся лента, подборка «Для вас», избранное. */
export function ModeTabs({ mode, showForYou, showSaved, showAll }: {
  mode: FeedMode;
  showForYou: () => void;
  showSaved: () => void;
  showAll: () => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center" role="tablist" aria-label="Какие вакансии показать">
      {([["all", "Все вакансии"], ["for-you", "Для вас"], ["saved", "Избранное"]] as const).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={mode === id}
          onClick={() => (id === "for-you" ? showForYou() : id === "saved" ? showSaved() : showAll())}
          className={`lg inline-flex items-center justify-center gap-1.5 px-2 sm:px-4 h-10 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            mode === id ? "lg lg-on" : "lg text-neutral-400 hover:text-neutral-100"
          }`}
        >
          {id === "for-you" && <Target className="hidden sm:block w-4 h-4" />}
          {id === "saved" && <Bookmark className="hidden sm:block w-4 h-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}
