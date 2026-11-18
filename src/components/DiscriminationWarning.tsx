"use client";

import { TriangleAlert } from "lucide-react";
import { findDiscrimination, isBlocked } from "@/lib/discrimination";

/**
 * Предупреждение работодателю, пока он пишет вакансию: в тексте есть требования к возрасту,
 * полу, национальности (ст. 13.11.1 КоАП РФ) или гражданству. Публикацию не запрещает:
 * база сама уберёт такую вакансию из ленты по vacancies.discrimination_flags.
 */
export default function DiscriminationWarning({ text }: { text: string }) {
  const findings = findDiscrimination(text);
  if (!findings.length) return null;
  const hidden = isBlocked(findings.map(f => f.flag));

  return (
    <div role="status" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
      <p className="flex items-center gap-2 font-semibold text-amber-200">
        <TriangleAlert aria-hidden="true" className="w-4 h-4 shrink-0" />
        {hidden ? "Вакансия не попадёт в ленту" : "Проверьте требование гражданства"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {findings.map(f => (
          <li key={f.flag}>
            <span className="font-medium">«{f.match}»</span> — требование: {f.label}. {f.law}
          </li>
        ))}
      </ul>
      {hidden && (
        <p className="mt-2 text-amber-200/80">
          Уберите эти требования из текста, и вакансия появится в ленте. Сейчас её увидят только кандидаты, которые уже откликнулись.
        </p>
      )}
    </div>
  );
}
