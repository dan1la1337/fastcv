import { createClient, type User } from "@supabase/supabase-js";

// NEXT_PUBLIC_* переменные подставляются в бандл во время `next build`,
// поэтому обращаться к ним нужно только напрямую, без динамических ключей.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Не заданы NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Скопируйте .env.example в .env.local и заполните значения (на Vercel — в Environment Variables).",
  );
}

// Секретный ключ (sb_secret_… или legacy service_role) обходит все правила
// доступа. Если его по ошибке положить в NEXT_PUBLIC_*, он уедет в браузер
// каждому посетителю — поэтому останавливаем сборку.
if (supabaseAnonKey.startsWith("sb_secret_") || isServiceRoleJwt(supabaseAnonKey)) {
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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserRole = "candidate" | "employer";

/**
 * Роль пользователя. Источник истины — таблица profiles (роль там защищена
 * от изменения триггером, см. supabase/schema.sql). Метаданные регистрации —
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
