import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LEGAL_DATE } from "@/lib/legal";

/** Оформление юридических страниц: заголовок, дата редакции, текст читаемой ширины. */
export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen text-neutral-200 px-4 py-8">
      <article className="max-w-3xl mx-auto space-y-6 text-sm leading-relaxed [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:pt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-teal-300 [&_a:hover]:underline">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> На главную
        </Link>
        <header className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">{title}</h1>
          <p className="text-neutral-500">Редакция от {LEGAL_DATE}</p>
        </header>
        {children}
      </article>
    </main>
  );
}
