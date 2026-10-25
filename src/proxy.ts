import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

/** Разделы только для вошедших и роль, которой они принадлежат (null — любая). */
const PROTECTED: { prefix: string; role: "candidate" | "employer" | null; elsewhere: string }[] = [
  { prefix: "/admin", role: null, elsewhere: "/" },
  { prefix: "/employer", role: "employer", elsewhere: "/applications" },
  { prefix: "/applications", role: "candidate", elsewhere: "/employer" },
  { prefix: "/profile", role: null, elsewhere: "/" },
  { prefix: "/welcome", role: "candidate", elsewhere: "/employer" },
];

/**
 * Выполняется на сервере перед каждой страницей:
 * 1. обновляет сессию Supabase в cookies (иначе через час пользователя «выкинет»);
 * 2. не пускает в кабинеты без входа и в кабинет чужой роли — до того, как страница
 *    отрисуется. Проверки на самих страницах остаются как второй рубеж.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Между созданием клиента и этим вызовом не должно быть другого кода: он обновляет сессию.
  // getClaims() проверяет подпись токена, в отличие от getSession().
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;

  const { pathname, search } = request.nextUrl;
  const rule = PROTECTED.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  if (!rule) return response;

  if (!userId) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(login, response);
  }

  if (rule.role) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    const role = profile?.role === "employer" ? "employer" : "candidate";
    if (role !== rule.role) {
      const target = request.nextUrl.clone();
      target.pathname = rule.elsewhere;
      target.search = "";
      return redirectWithCookies(target, response);
    }
  }

  return response;
}

/** Редирект, который сохраняет обновлённые cookies сессии и запрет кеширования. */
function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  matcher: [
    // Всё, кроме прокси к Supabase (/sb), статики, картинок и служебных файлов: сессия нужна и страницам, и API
    "/((?!sb/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
