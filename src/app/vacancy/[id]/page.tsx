import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, Briefcase, Building2, Calendar, ExternalLink, Globe, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatLabel, formatSalary, levelLabel, type Vacancy } from "@/lib/vacancies";
import ApplyButton from "@/components/ApplyButton";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// cache(): метаданные и страница берут вакансию одним запросом
const getVacancy = cache(async (id: string): Promise<Vacancy | null> => {
  if (!UUID.test(id)) return null;
  const { data } = await supabase.from("vacancies").select("*").eq("id", id).maybeSingle();
  return (data as Vacancy) ?? null;
});

function summary(v: Vacancy): string {
  const parts = [
    formatSalary(v.salary_min, v.salary_max, v.salary_currency),
    levelLabel(v.level),
    v.city,
    formatLabel(v.work_format)?.toLowerCase() ?? (v.is_remote ? "удалённо" : null),
  ];
  const head = parts.filter(Boolean).join(" · ");
  return `${head}. ${v.description ?? ""}`.slice(0, 200);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const vacancy = await getVacancy((await params).id);
  if (!vacancy) return { title: "Вакансия не найдена — FastCV" };
  return {
    title: `${vacancy.title}${vacancy.company_name ? ` в ${vacancy.company_name}` : ""} — FastCV`,
    description: summary(vacancy),
    alternates: { canonical: `/vacancy/${vacancy.id}` },
    openGraph: { title: vacancy.title, description: summary(vacancy), type: "article" },
    // Архивные вакансии открываются по старым ссылкам, но в поиск не попадают
    robots: vacancy.archived_at ? { index: false } : undefined,
  };
}

/** Разметка schema.org/JobPosting: по ней Google показывает вакансии в поиске. */
function jobPostingJsonLd(v: Vacancy) {
  const posted = v.posted_at ?? v.created_at;
  const validThrough = new Date(Date.parse(posted) + 30 * 864e5).toISOString();
  const salaryValue = v.salary_min || v.salary_max
    ? {
        "@type": "MonetaryAmount",
        currency: v.salary_currency ?? undefined,
        value: { "@type": "QuantitativeValue", minValue: v.salary_min ?? undefined, maxValue: v.salary_max ?? undefined, unitText: "MONTH" },
      }
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: v.title,
    description: v.description ?? v.title,
    datePosted: posted,
    validThrough,
    ...(v.work_format === "remote" || (!v.work_format && v.is_remote) ? { jobLocationType: "TELECOMMUTE" } : {}),
    ...(v.city ? { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: v.city } } } : {}),
    ...(salaryValue && v.salary_currency ? { baseSalary: salaryValue } : {}),
    ...(v.stack?.length ? { skills: v.stack.join(", ") } : {}),
    ...(v.company_name ? { hiringOrganization: { "@type": "Organization", name: v.company_name } } : {}),
  };
}

export default async function VacancyPage({ params }: Props) {
  const vacancy = await getVacancy((await params).id);
  if (!vacancy) notFound();

  const posted = new Date(vacancy.posted_at ?? vacancy.created_at).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      {!vacancy.archived_at && (
        <script
          type="application/ld+json"
          // JSON.stringify экранирует строки; "<" заменяем, чтобы текст вакансии не мог закрыть тег
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd(vacancy)).replace(/</g, "\\u003c") }}
        />
      )}

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" /> Все вакансии
        </Link>

        {vacancy.archived_at && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Вакансия в архиве: скорее всего, она уже закрыта.
          </div>
        )}

        <article className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <header className="space-y-3">
            <span className={`inline-block text-[10px] uppercase font-bold px-2.5 py-1 rounded-md border ${
              vacancy.source_type === "internal"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-blue-500/10 text-blue-400 border-blue-500/20"
            }`}>
              {vacancy.source_type === "internal" ? "Прямой работодатель" : "Telegram"}
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{vacancy.title}</h1>
            {vacancy.company_name && <p className="text-base text-neutral-300">{vacancy.company_name}</p>}
            <p className="text-xl font-semibold text-emerald-400">
              {formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency)}
            </p>
            <p className="flex flex-wrap items-center gap-4 text-sm text-neutral-400">
              {vacancy.city && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" />{vacancy.city}</span>}
              {vacancy.level && <span className="inline-flex items-center gap-1.5"><Briefcase className="w-4 h-4" />{levelLabel(vacancy.level)}</span>}
              {vacancy.work_format === "remote" || (!vacancy.work_format && vacancy.is_remote)
                ? <span className="inline-flex items-center gap-1.5"><Globe className="w-4 h-4" />Удалённо</span>
                : vacancy.work_format && <span className="inline-flex items-center gap-1.5"><Building2 className="w-4 h-4" />{formatLabel(vacancy.work_format)}</span>}
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4" />{posted}</span>
            </p>
          </header>

          {vacancy.description && (
            <p className="text-neutral-300 leading-relaxed whitespace-pre-line">{vacancy.description}</p>
          )}

          {vacancy.stack && vacancy.stack.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {vacancy.stack.map(tech => (
                <span key={tech} className="text-xs px-2.5 py-1 rounded-md bg-neutral-800/80 border border-neutral-700/60 text-neutral-300">{tech}</span>
              ))}
            </div>
          )}

          <footer className="flex flex-wrap items-center gap-4 pt-4 border-t border-neutral-800">
            {!vacancy.archived_at && <ApplyButton vacancy={vacancy} />}
            {vacancy.source_url && (
              <a
                href={vacancy.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-blue-400 transition-colors"
              >
                Оригинальный пост в Telegram <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </footer>
        </article>
      </div>
    </div>
  );
}
