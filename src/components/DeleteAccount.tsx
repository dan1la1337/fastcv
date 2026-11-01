"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

const CONFIRM_WORD = "удалить";

/**
 * Удаление аккаунта (152-ФЗ). Сначала файлы резюме из хранилища (из SQL их не удалить),
 * потом delete_my_account() — профиль, отклики или вакансии, избранное, письма, сам аккаунт.
 */
export default function DeleteAccount({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const files = await supabase.storage.from("resumes").list(userId);
    const paths = (files.data ?? []).map(f => `${userId}/${f.name}`);
    if (paths.length) await supabase.storage.from("resumes").remove(paths);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setError("Не получилось удалить аккаунт. Попробуйте ещё раз или напишите нам — удалим вручную.");
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    router.push("/?account=deleted");
    router.refresh();
  }

  return (
    <div className="glass rounded-3xl p-6 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Удаление аккаунта</h2>
        <p className="text-sm text-neutral-400 mt-1">
          Удалятся профиль, резюме, отклики, письма и избранное. Отменить это нельзя.
        </p>
      </div>
      {!open ? (
        <button onClick={() => setOpen(true)}
          className="lg lg-danger inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-red-300 transition-colors">
          <Trash2 className="w-4 h-4" /> Удалить аккаунт
        </button>
      ) : (
        <div className="space-y-3">
          <label htmlFor="confirm-delete" className="block text-sm text-neutral-300">
            Чтобы подтвердить, введите слово «{CONFIRM_WORD}»
          </label>
          <input id="confirm-delete" value={word} onChange={e => setWord(e.target.value)} autoComplete="off"
            className="neu-in w-full rounded-2xl px-4 py-3 text-sm text-neutral-200" />
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={remove} disabled={busy || word.trim().toLowerCase() !== CONFIRM_WORD}
              className="lg lg-danger inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-colors">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Удалить навсегда
            </button>
            <button onClick={() => { setOpen(false); setWord(""); }} disabled={busy}
              className="lg px-4 py-2.5 rounded-xl text-sm text-neutral-300">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
