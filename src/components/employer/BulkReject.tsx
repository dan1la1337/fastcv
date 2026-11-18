import { Loader2, XCircle } from "lucide-react";
import { REJECT_REASONS } from "@/lib/employer";

/** Выбор ждущих откликов и массовый отказ выбранным. */
export default function BulkReject({ waitingIds, weakIds, selected, setSelected, bulk, setBulk, bulkSending, onSend }: {
  /** Отклики, которые ждут ответа. */
  waitingIds: string[];
  /** Из них слабые по вердикту ИИ. */
  weakIds: string[];
  selected: Set<string>;
  setSelected: (selected: Set<string>) => void;
  /** Открыта панель отказа и выбранная причина. */
  bulk: { reason: string | null } | null;
  setBulk: (bulk: { reason: string | null } | null) => void;
  bulkSending: boolean;
  onSend: () => void;
}) {
  return (
    <>
      {waitingIds.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Выбор откликов">
          <span className="text-neutral-500">Выбрать:</span>
          <button onClick={() => setSelected(new Set(waitingIds))} className="lg px-3 py-1 rounded-full text-neutral-300">все ждущие · {waitingIds.length}</button>
          {weakIds.length > 0 && (
            <button onClick={() => setSelected(new Set(weakIds))} className="lg px-3 py-1 rounded-full text-neutral-300">слабые по ИИ · {weakIds.length}</button>
          )}
          {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="px-3 py-1 text-neutral-400 hover:text-white">снять выбор</button>}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-20 md:bottom-4 z-20 glass rounded-2xl p-4 space-y-3" aria-label="Действия с выбранными">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-white font-semibold">Выбрано: {selected.size}</p>
            <span className="flex-1" />
            {!bulk && (
              <button onClick={() => setBulk({ reason: null })}
                className="lg h-10 px-4 rounded-full text-sm text-neutral-200 hover:text-red-200 inline-flex items-center gap-1.5">
                <XCircle className="w-4 h-4" /> Отказать выбранным
              </button>
            )}
          </div>
          {bulk && (
            <div className="space-y-3">
              <p className="text-xs text-neutral-400">Каждый кандидат получит вежливый отказ с названием своей вакансии. Причина — по желанию, кандидатам она полезна.</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Причина отказа для всех">
                {REJECT_REASONS.map(r => (
                  <button key={r.label} type="button" aria-pressed={bulk.reason === r.label}
                    onClick={() => setBulk({ reason: bulk.reason === r.label ? null : r.label })}
                    className={`lg px-3 py-1 rounded-full text-xs transition-colors ${bulk.reason === r.label ? "lg lg-on" : "lg text-neutral-300"}`}>
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setBulk(null)} className="px-3 h-10 text-sm text-neutral-400 hover:text-white">Отмена</button>
                <button onClick={onSend} disabled={bulkSending}
                  className="lg lg-accent h-10 px-5 rounded-full text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                  {bulkSending && <Loader2 className="w-4 h-4 animate-spin" />} Отправить отказы · {selected.size}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
