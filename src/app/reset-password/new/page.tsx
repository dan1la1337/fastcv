"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getUserRole, homeForRole, supabase } from "@/lib/supabase";
import { authErrorText } from "@/lib/auth-errors";

const input = "w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors";

/** Новый пароль. Сюда попадают по ссылке из письма: /auth/callback уже создал сессию. */
export default function NewPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setReady(Boolean(data.user)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) {
      setError("Пароли не совпадают.");
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error || !data.user) {
      setError(authErrorText(error?.message));
      setLoading(false);
      return;
    }
    router.push(`${homeForRole(await getUserRole(data.user))}?password=changed`);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">Новый пароль</h1>
        {ready === false ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-neutral-400">Ссылка устарела или уже использована. Запросите новое письмо.</p>
            <Link href="/reset-password" className="inline-block text-sm text-blue-400 hover:underline">Сбросить пароль ещё раз</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Новый пароль</label>
              <input id="password" type="password" required minLength={6} autoComplete="new-password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Минимум 6 символов" className={input} />
            </div>
            <div>
              <label htmlFor="repeat" className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Ещё раз</label>
              <input id="repeat" type="password" required minLength={6} autoComplete="new-password" value={repeat}
                onChange={e => setRepeat(e.target.value)} className={input} />
            </div>
            {error && <p role="alert" className="text-sm text-red-400 bg-red-950/30 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
            <button type="submit" disabled={loading || ready === null}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Сохранить пароль"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
