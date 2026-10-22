"use client";

import { Suspense, useState } from "react";
import { supabase, getUserRole, homeForRole } from "@/lib/supabase";
import { authErrorText } from "@/lib/auth-errors";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";

function LoginForm() {
  const searchParams = useSearchParams();
  // Куда вернуть после входа: только путь на нашем сайте
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Ошибка из ссылки письма (/auth/callback) показывается сразу
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      setError(authErrorText(error?.message));
      setLoading(false);
      return;
    }

    // Работодателя — в кабинет HR, кандидата — на главную к вакансиям
    const role = await getUserRole(data.user);
    router.push(next ?? homeForRole(role));
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
            <span className="bg-blue-600 text-white font-black px-2.5 py-1 rounded-lg text-sm tracking-tight shadow-lg shadow-blue-500/25">⚡ Fast<span className="text-blue-200">CV</span></span>
          </Link>
          <h1 className="text-2xl font-bold text-white">
            С возвращением
          </h1>
          <p className="text-neutral-400 text-sm mt-2">
            Войдите, чтобы откликаться с помощью ИИ
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Пароль</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Минимум 6 символов"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-950/30 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 mt-6"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Войти"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/register"
            className="text-sm text-neutral-400 hover:text-white transition-colors"
          >
            Нет аккаунта? Создать
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-950" />}>
      <LoginForm />
    </Suspense>
  );
}
