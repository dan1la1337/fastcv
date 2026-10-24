import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Toaster from "@/components/Toaster";
import { OPERATOR } from "@/lib/legal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"], // кириллица: иначе весь русский текст рисуется системным шрифтом
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"], // кириллица: иначе весь русский текст рисуется системным шрифтом
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950">
        {children}
        <footer className="mt-auto border-t border-neutral-900 px-4 py-6 text-xs text-neutral-400">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>© FastCV</span>
            <Link href="/jobs" className="hover:text-neutral-200">Вакансии по направлениям</Link>
            <Link href="/terms" className="hover:text-neutral-200">Пользовательское соглашение</Link>
            <Link href="/privacy" className="hover:text-neutral-200">Политика обработки данных</Link>
            <a href={`mailto:${OPERATOR.email}`} className="hover:text-neutral-200">{OPERATOR.email}</a>
          </div>
        </footer>
        <Toaster />
      </body>
    </html>
  );
}