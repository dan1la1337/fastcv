import { createClient, type User } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

// NEXT_PUBLIC_* переменные подставляются в бандл во время `next build`,
// поэтому обращаться к ним нужно только напрямую, без динамических ключей.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Не заданы NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Скопируйте .env.example в .env.local и заполните значения (на Vercel — в Environment Variables).",
  );
}

// Секретный ключ (sb_secret_… или legacy service_role) обходит все правила
// доступа. Если его по ошибке положить в NEXT_PUBLIC_*, он уедет в браузер
// каждому посетителю — поэтому останавливаем сборку.
if (anonKey.startsWith("sb_secret_") || isServiceRoleJwt(anonKey)) {
  throw new Error(
    "В NEXT_PUBLIC_SUPABASE_ANON_KEY лежит секретный ключ Supabase. " +
      "Нужен публичный ключ (sb_publishable_… или anon) из Supabase → Project Settings → API Keys.",
  );
}

function isServiceRoleJwt(key: string): boolean {
  try {
    const payload = key.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json?.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * Браузер ходит в Supabase через fastcv.ru (перезапись в next.config.ts), а не напрямую
 * на *.supabase.co: у части пользователей из России прямые запросы туда обрываются
 * («TypeError: Load failed» на iPhone), а запросы к своему домену проходят.
 */
export const SUPABASE_PROXY_PATH = "/sb";

/** Имя cookie сессии по умолчанию у Supabase: sb-<id проекта>-auth-token. */
export function sessionCookieName(projectUrl: string): string {
  return `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
}

export const supabaseUrl: string = url;
export const supabaseAnonKey: string = anonKey;

/**
 * Клиент Supabase для кода, который работает и в браузере, и на сервере.
 * - В браузере запросы идут через fastcv.ru/sb (см. SUPABASE_PROXY_PATH), сессия хранится в cookies (`@supabase/ssr`): так её видит сервер,
 *   и кабинеты закрываются ещё до отрисовки (см. src/proxy.ts).
 * - На сервере (страница вакансии, карта сайта) — клиент без сессии для публичных
 *   данных. Код, которому нужен вошедший пользователь на сервере, берёт клиент
 *   из src/lib/supabase-server.ts.
 */
export const supabase =
  typeof window === "undefined"
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : createBrowserClient<Database>(`${window.location.origin}${SUPABASE_PROXY_PATH}`, supabaseAnonKey, {
        // Имя cookie сессии считается от адреса; оставляем прежнее, чтобы его видел сервер
        cookieOptions: { name: sessionCookieName(supabaseUrl) },
      });

export type UserRole = "candidate" | "employer";

/**
 * Роль пользователя. Источник истины — таблица profiles (роль там защищена
 * от изменения триггером, см. supabase/migrations). Метаданные регистрации —
 * только запасной вариант, пока строка профиля ещё не создана.
 */
export async function getUserRole(user: User): Promise<UserRole> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = data?.role ?? user.user_metadata?.role;
  return role === "employer" ? "employer" : "candidate";
}

/** Куда вести пользователя после входа или подтверждения почты. */
export function homeForRole(role: UserRole): string {
  return role === "employer" ? "/employer" : "/";
}
