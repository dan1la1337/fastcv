"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Проверяем роль и направляем в нужный кабинет
      const role = data.user?.user_metadata?.role;
      if (role === 'employer') {
        router.push('/dashboard/company');
      } else {
        router.push('/'); // Кандидата на главную к вакансиям
      }
    } catch (error: any) {
      alert(error.message || "Ошибка авторизации. Проверьте логин и пароль.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
            <span className="bg-blue-600 text-white font-black px-2.5 py-1 rounded-md text-xs tracking-widest">SJT</span>
            <span className="font-semibold text-neutral-100">Job Aggregator</span>
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