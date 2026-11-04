"use client";

import FormError from "@/components/FormError";
import Logo from "@/components/Logo";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getUserRole, homeForRole, supabase } from "@/lib/supabase";
import { authErrorText } from "@/lib/auth-errors";

const input = "w-full px-4 py-3 neu-in rounded-2xl text-sm text-neutral-100 transition-colors";

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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass max-w-md w-full rounded-3xl p-8">
        <div className="text-center mb-6"><Logo /></div>
        <h1 className="font-display text-2xl font-bold text-white text-center mb-6">Новый пароль</h1>
        {ready === false ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-neutral-400">Ссылка устарела или уже использована. Запросите новое письмо.</p>
            <Link href="/reset-password" className="inline-block text-sm text-teal-300 hover:underline">Сбросить пароль ещё раз</Link>
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
            {error && <FormError>{error}</FormError>}
            <button type="submit" disabled={loading || ready === null}
              className="lg lg-accent w-full flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition-colors disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Сохранить пароль"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
