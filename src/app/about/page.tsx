import type { Metadata } from "next";
import Link from "next/link";
import Hero from "@/components/Hero";
import Logo from "@/components/Logo";
import { fetchLiveStats } from "@/lib/live";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "О сервисе — FastCV",
  description: "FastCV собирает вакансии из Telegram, сайтов компаний, SuperJob и «Работы России» и показывает, насколько каждая подходит именно вам.",
  alternates: { canonical: "/about" },
};

/** Главная страница сервиса для всех, в том числе вошедших (на «/» им сразу лента). */
export default async function AboutPage() {
  const stats = await fetchLiveStats().catch(() => null);
  return (
    <div className="min-h-screen text-neutral-100">
      <header className="sticky top-0 z-20 px-3 sm:px-4 pt-3">
        <div className="glass rounded-[26px] max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center justify-between gap-3">
          <Logo />
          <Link href="/" className="lg lg-accent px-4 py-2 rounded-full text-sm font-semibold transition-colors">
            К вакансиям
          </Link>
        </div>
      </header>
      <Hero stats={stats} always />
    </div>
  );
}
