import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Unbounded } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Suspense } from "react";
import Toaster from "@/components/Toaster";
import MobileNav from "@/components/MobileNav";
import { OPERATOR } from "@/lib/legal";

// Тема «Аврора»: Inter — текст, Unbounded — заголовки и логотип, JetBrains Mono — счётчики.
// Кириллица обязательна: иначе русский текст рисуется системным шрифтом
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin", "cyrillic"], weight: ["600", "700"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin", "cyrillic"], weight: ["500"] });

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
      className={`${inter.variable} ${unbounded.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: AUTH_HINT }} />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-950 relative">
        {/* Сияние «Авроры» за всеми страницами; сами страницы прозрачные */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="aurora-a absolute -left-32 -top-40 h-[560px] w-[760px] rounded-full bg-[radial-gradient(closest-side,rgba(45,212,191,0.22),transparent)] blur-3xl" />
          <div className="aurora-b absolute -right-40 top-20 h-[620px] w-[820px] rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.20),transparent)] blur-3xl" />
        </div>
        {children}
        <footer className="mt-auto border-t border-white/10 px-4 py-6 text-xs text-neutral-400">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2">
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