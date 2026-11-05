import type { Metadata } from "next";
// Шрифт — из npm-пакета, а не с Google Fonts: сборка не зависит от доступности
// fonts.googleapis.com (5.11 прод-деплой упал на загрузке шрифта), посетители не ходят к Google
import "@fontsource-variable/onest";
import "./globals.css";
import Link from "next/link";
import { Suspense } from "react";
import Toaster from "@/components/Toaster";
import MobileNav from "@/components/MobileNav";
import { OPERATOR } from "@/lib/legal";

// Дизайн-система Obsidian Glass: одно семейство на оба алфавита. В вакансиях латиница идёт вперемешку
// с кириллицей («Python-разработчик»), и пара разных шрифтов давала скачки размера и толщины внутри слова
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
      className="h-full antialiased"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: AUTH_HINT }} />
      </head>
      <body className="min-h-full flex flex-col relative">
        {/* Фон за всеми страницами: мягкое свечение, на витринах (.showcase) — стеклянные шары у правого края */}
        <div aria-hidden="true" className="page-backdrop pointer-events-none fixed inset-0 -z-10" />
        {children}
        <footer className="mt-auto border-t border-white/10 px-4 py-6 text-xs text-neutral-400">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>© FastCV</span>
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