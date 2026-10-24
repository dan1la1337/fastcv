import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Сюда ведёт ссылка из письма Supabase (подтверждение почты, сброс пароля).
 * Код из ссылки обменивается на сессию на сервере, сессия кладётся в cookies,
 * и пользователь уходит в свой раздел: при первом входе — заполнять профиль.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const toLogin = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);

  // Supabase присылает ошибку ссылки по-английски («Email link is invalid or has expired»)
  const linkError = searchParams.get("error_description") || searchParams.get("error");
  if (linkError) {
    console.warn("Auth link error", linkError);
    return toLogin("Ссылка недействительна или устарела. Войдите или запросите письмо ещё раз.");
  }

  const supabase = await createSupabaseServerClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("В ссылке нет кода подтверждения") };

  if (error) return toLogin("Ссылка недействительна или устарела. Войдите или запросите письмо ещё раз.");

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return toLogin("Не удалось войти. Попробуйте ещё раз.");

  // Ссылка из письма сброса пароля — сразу на форму нового пароля
  const next = searchParams.get("next");
  if (type === "recovery" || next === "/reset-password/new") return NextResponse.redirect(`${origin}/reset-password/new`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", auth.user.id)
    .maybeSingle();

  // Внутренний адрес возврата (?next=/vacancy/…) — только путь на нашем сайте
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  // Первый вход: кандидата — в онбординг «Что вы ищете?», работодателя — заполнить компанию
  const target = !profile?.name
    ? (profile?.role === "employer" ? "/profile" : "/welcome")
    : safeNext ?? (profile.role === "employer" ? "/employer" : "/");
  return NextResponse.redirect(`${origin}${target}`);
}
