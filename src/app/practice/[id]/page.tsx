import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import InterviewPractice from "./InterviewPractice";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Тренажёр собеседования — FastCV", robots: { index: false } };

/** Тренажёр собеседования по конкретной вакансии (только для кандидатов — см. proxy.ts). */
export default async function PracticePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data: vacancy } = await supabase.from("vacancies").select("id, title, company_name").eq("id", id).maybeSingle();
  if (!vacancy) notFound();

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link href={`/vacancy/${vacancy.id}`} className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> К вакансии
        </Link>
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-teal-300 font-semibold">Тренажёр собеседования</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">{vacancy.title}</h1>
          {vacancy.company_name && <p className="text-sm text-neutral-400">{vacancy.company_name}</p>}
        </header>
        <InterviewPractice vacancyId={vacancy.id} title={vacancy.title} />
      </div>
    </main>
  );
}
