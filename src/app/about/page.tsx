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
      <header className="border-b border-white/10 bg-neutral-950/70 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between gap-3">
          <Logo />
          <Link href="/" className="px-4 py-2 rounded-full text-sm bg-teal-300 text-neutral-950 font-semibold hover:bg-teal-200 transition-colors">
            К вакансиям
          </Link>
        </div>
      </header>
      <Hero stats={stats} always />
    </div>
  );
}
