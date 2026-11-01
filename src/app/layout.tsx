import type { Metadata } from "next";
import { Montserrat, Poppins } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Suspense } from "react";
import Toaster from "@/components/Toaster";
import MobileNav from "@/components/MobileNav";
import { OPERATOR } from "@/lib/legal";

// Дизайн-система Obsidian Glass: одно семейство — Poppins (300–600).
// У Poppins нет кириллицы, поэтому русские буквы берёт Montserrat — такой же геометрический гротеск:
// браузер сам выбирает начертание по символу (Poppins в стеке первым)
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["cyrillic"], weight: ["300", "400", "500", "600"] });

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
      className={`${poppins.variable} ${montserrat.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: AUTH_HINT }} />
      </head>
      <body className="min-h-full flex flex-col relative">
        {/* Орбы Obsidian Glass за всеми страницами: стеклу нужно, что размывать.
            Два размытых пятна mist и три глянцевых шара разного размера, часть срезана краем */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="og-orb og-orb--blur orb-drift-a" style={{ width: 460, height: 460, left: -120, top: 80 }} />
          <div className="og-orb og-orb--blur orb-drift-b" style={{ width: 380, height: 380, right: -90, top: "48%" }} />
          <div className="og-orb orb-drift-b hidden sm:block" style={{ width: 150, height: 150, right: "9%", top: 96 }} />
          <div className="og-orb orb-drift-a hidden sm:block" style={{ width: 64, height: 64, right: "3%", bottom: "16%" }} />
          <div className="og-orb orb-drift-b" style={{ width: 120, height: 120, left: -40, bottom: -30 }} />
        </div>
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