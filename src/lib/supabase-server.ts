import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

/**
 * Клиент Supabase для серверного кода (route handlers, server components) от имени
 * вошедшего пользователя: сессия берётся из cookies, запросы проходят его правила доступа.
 * Создавать заново на каждый запрос — общий клиент перемешал бы сессии разных людей.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Из server component cookies менять нельзя — сессию обновляет src/proxy.ts
        }
      },
    },
  });
}
