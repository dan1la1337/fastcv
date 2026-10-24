"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authErrorText } from "@/lib/auth-errors";

const card = "max-w-md w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl p-8 shadow-2xl";

/** Запрос письма для сброса пароля. Ссылка из письма ведёт на /reset-password/new через /auth/callback. */
export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password/new`,
    });
    setLoading(false);
    // Не сообщаем, есть ли такой аккаунт: иначе по форме можно перебирать чужие адреса
    if (error && !/not found|user/i.test(error.message)) {
      setError(authErrorText(error.message));
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className={card}>
        {sent ? (
          <div className="text-center space-y-4">
            <MailCheck className="w-10 h-10 text-blue-400 mx-auto" />
            <h1 className="text-2xl font-bold text-white">Проверьте почту</h1>
            <p className="text-neutral-400 text-sm leading-relaxed">
              Если аккаунт с адресом <span className="font-medium text-neutral-100">{email}</span> существует,
              мы отправили на него ссылку для смены пароля.
            </p>
            <p className="text-neutral-500 text-xs">Письма нет? Проверьте папку «Спам».</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white text-center">Сброс пароля</h1>
            <p className="text-neutral-400 text-sm mt-2 mb-6 text-center">Пришлём ссылку для смены пароля на вашу почту</p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Email</label>
                <input id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
              {error && <p role="alert" className="text-sm text-red-400 bg-red-950/30 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Отправить ссылку"}
              </button>
            </form>
          </>
        )}
        <div className="mt-6 text-sm">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> Ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}
