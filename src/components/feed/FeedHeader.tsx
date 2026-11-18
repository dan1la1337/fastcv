import Link from "next/link";
import Logo from "@/components/Logo";
import UserMenu from "@/components/UserMenu";
import { plural, VACANCY_FORMS } from "@/lib/vacancies";

/** Шапка ленты: логотип, счётчик вакансий, меню пользователя или кнопка входа. */
export default function FeedHeader({ loading, total, signedIn, isEmployer, email }: {
  loading: boolean;
  total: number;
  signedIn: boolean;
  isEmployer: boolean;
  email: string | undefined;
}) {
  return (
    <header className="top-strip sticky top-0 z-20 px-3 sm:px-4 pt-3 pb-3">
      <div className="glass rounded-3xl max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-2 sm:gap-4">
          <span className="inline-flex items-center gap-2 tabular-nums text-xs text-teal-300 whitespace-nowrap">
            <span className="relative h-2 w-2" aria-hidden="true">
              <span className="live-ping absolute inset-0 rounded-full bg-teal-300" />
              <span className="absolute inset-0 rounded-full bg-teal-300" />
            </span>
            {loading ? "…" : `${total.toLocaleString("ru-RU")} ${plural(total, VACANCY_FORMS)}`}
          </span>
          
          {signedIn ? (
            <UserMenu role={isEmployer ? "employer" : "candidate"} email={email} />
          ) : (
            <Link 
              href="/login"
              className="guest-only lg px-4 py-2 text-neutral-100 rounded-full text-sm font-medium transition-colors relative z-50 whitespace-nowrap"
            >
              Войти<span className="hidden sm:inline"> / Регистрация</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
