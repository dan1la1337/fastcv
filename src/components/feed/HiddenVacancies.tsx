import Link from "next/link";
import { Undo2 } from "lucide-react";
import type { MarkKind } from "@/lib/marks";
import type { Vacancy } from "@/lib/vacancies";

/** Скрытые вакансии во вкладке «Избранное»: любую можно вернуть в ленту. */
export default function HiddenVacancies({ hiddenList, onToggleMark }: {
  hiddenList: Vacancy[];
  onToggleMark: (item: Vacancy, kind: MarkKind) => void;
}) {
  return (
    <details className="neu-sub rounded-3xl px-5 py-4">
      <summary className="cursor-pointer text-sm text-neutral-300">Скрытые вакансии ({hiddenList.length})</summary>
      <ul className="mt-3 space-y-2">
        {hiddenList.map(v => (
          <li key={v.id} className="flex items-center justify-between gap-3 text-sm">
            <Link href={`/vacancy/${v.id}`} className="text-neutral-300 hover:text-teal-300 truncate">{v.title}</Link>
            <button onClick={() => onToggleMark(v, "hidden")} className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline shrink-0">
              <Undo2 className="w-3.5 h-3.5" /> Вернуть в ленту
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
