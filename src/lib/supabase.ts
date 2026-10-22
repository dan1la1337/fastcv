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
