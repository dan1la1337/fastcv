import type { Metadata } from "next";
import { Exo_2, Titillium_Web } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Suspense } from "react";
import Toaster from "@/components/Toaster";
import MobileNav from "@/components/MobileNav";
import { OPERATOR } from "@/lib/legal";

// Шрифт — Titillium Web в четырёх толщинах: Light 300, Regular 400, SemiBold 600, Black 900.
// У Titillium нет кириллицы, поэтому русские буквы рисует Exo 2 — близкий по характеру гротеск
// в тех же толщинах; браузер выбирает начертание по символу (Titillium в стеке первым)
const titillium = Titillium_Web({ variable: "--font-titillium", subsets: ["latin"], weight: ["300", "400", "600", "900"] });
const exo = Exo_2({ variable: "--font-exo", subsets: ["cyrillic"], weight: ["300", "400", "600", "900"] });

// Признак входа до первой отрисовки: вошедшим не показываем экран-приветствие (.guest-only).
// Куки сессии Supabase читаются из браузера; сама сессия здесь не проверяется — только скрытие блока
const AUTH_HINT = `try{if(/(^|; )sb-[^=]+-auth-token/.test(document.cookie))document.documentElement.dataset.auth="1"}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL("https://fastcv.ru"),
  title: "FastCV — вакансии с откликом от ИИ",
  description: "Свежие вакансии из Telegram-каналов, SuperJob, «Работы России» и от прямых работодателей: IT, digital и другие профессии. Сопроводительное письмо под каждую вакансию пишет ИИ.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${titillium.variable} ${exo.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: AUTH_HINT }} />
      </head>
      <body className="min-h-full flex flex-col relative">
        {/* Фон за всеми страницами: затемнённая фотография светового шлейфа — стеклу есть что размывать */}
        <div aria-hidden="true" className="page-backdrop pointer-events-none fixed inset-0 -z-10" />
        {children}
        <footer className="mt-auto border-t border-white/10 px-4 py-6 text-xs text-neutral-400">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>© FastCV</span>
            <Link href="/about" className="hover:text-neutral-200">О сервисе</Link>
            <Link href="/jobs" className="hover:text-neutral-200">Вакансии по направлениям</Link>
            <Link href="/terms" className="hover:text-neutral-200">Пользовательское соглашение</Link>
            <Link href="/privacy" className="hover:text-neutral-200">Политика обработки данных</Link>
            <Link href="/sources" className="hover:text-neutral-200">Источники вакансий</Link>
            <a href={`mailto:${OPERATOR.email}`} className="hover:text-neutral-200">{OPERATOR.email}</a>
          </div>
        </footer>
        <Suspense fallback={null}><MobileNav /></Suspense>
        <Toaster />
      </body>
    </html>
  );
}