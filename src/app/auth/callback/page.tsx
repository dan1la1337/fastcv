"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { supabase, getUserRole, homeForRole } from "@/lib/supabase";

// Сюда ведёт ссылка из письма подтверждения (emailRedirectTo при регистрации).
// Клиент Supabase сам разбирает токен из адреса (detectSessionInUrl),
// нам остаётся дождаться сессии и отправить пользователя в нужный раздел.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search || window.location.hash.replace(/^#/, "?"),
    );
    const urlError = params.get("error_description") || params.get("error");
    if (urlError) {
      // Асинхронно, чтобы не вызывать каскадный рендер прямо из эффекта
      Promise.resolve().then(() => setError(urlError));
      return;
    }

    let done = false;
    const finish = async () => {
      if (done) return;
      const { data } = await supabase.auth.getUser();
      if (!data.user || done) return;
      done = true;
      // Первый вход — заполнить профиль, иначе — в свой раздел
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!profile?.name) {
        router.replace("/profile");
      } else {
        router.replace(homeForRole(await getUserRole(data.user)));
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });
    finish();

    const timeout = setTimeout(() => {
      if (!done) setError("Ссылка недействительна или устарела. Попробуйте войти ещё раз.");
    }, 10000);

    return () => {
      done = true;
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
      {error ? (
        <div className="max-w-md w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl p-8 text-center space-y-4">
          <h1 className="text-xl font-bold">Не удалось подтвердить вход</h1>
          <p className="text-sm text-neutral-400">{error}</p>
          <Link
            href="/login"
            className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold transition-colors"
          >
            Перейти ко входу
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-neutral-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> Входим в аккаунт...
        </div>
      )}
    </div>
  );
}
