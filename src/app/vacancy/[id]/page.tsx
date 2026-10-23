import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AlertTriangle, ArrowLeft, Briefcase, Building2, Calendar, ExternalLink, Globe, MapPin, Megaphone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { VACANCY_COLUMNS, formatLabel, formatSalary, levelLabel, experienceLabel, plural, sourceOf, type Vacancy } from "@/lib/vacancies";
import ApplyButton from "@/components/ApplyButton";
import ViewCounter from "@/components/ViewCounter";
import CompanyLine from "@/components/CompanyLine";
import { estimateSalary, fetchSalaryBenchmarks } from "@/lib/salary";
import SalaryEstimate from "@/components/SalaryEstimate";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// cache(): метаданные и страница берут вакансию одним запросом
const getVacancy = cache(async (id: string): Promise<Vacancy | null> => {
  if (!UUID.test(id)) return null;
  const { data } = await supabase.from("vacancies").select(VACANCY_COLUMNS).eq("id", id).maybeSingle();
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

const isMirrored = (v: { source_url?: string | null }) => Boolean(v.source_url?.includes("trudvsem.ru"));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const vacancy = await getVacancy((await params).id);
  if (!vacancy) return { title: "Вакансия не найдена — FastCV" };
  return {
    title: `${vacancy.title}${vacancy.company_name ? ` в ${vacancy.company_name}` : ""} — FastCV`,
    description: summary(vacancy),
    alternates: { canonical: `/vacancy/${vacancy.id}` },
    openGraph: { title: vacancy.title, description: summary(vacancy), type: "article" },
    // В поиск не попадают архивные вакансии (открываются по старым ссылкам) и вакансии
    // «Работы России»: они живут 2 дня и повторяют trudvsem.ru — в выдаче были бы дубли и 404
    robots: vacancy.archived_at || isMirrored(vacancy) ? { index: false } : undefined,
  };
}

/**
 * Разметка schema.org/JobPosting: по ней Google показывает вакансии в поиске.
 * Обязательны компания и место работы (город; для удалёнки Google ещё требует страну
 * кандидата, а её в постах нет). Без них разметка не выводится: неполная только
 * копит ошибки в Search Console и всё равно не попадает в выдачу вакансий.
 */
function jobPostingJsonLd(v: Vacancy) {
  if (!v.company_name?.trim() || !v.city) return null;
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
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: v.city } },
    ...(salaryValue && v.salary_currency ? { baseSalary: salaryValue } : {}),
    ...(v.stack?.length ? { skills: v.stack.join(", ") } : {}),
    hiringOrganization: { "@type": "Organization", name: v.company_name.trim() },
  };
}

export default async function VacancyPage({ params }: Props) {
  const vacancy = await getVacancy((await params).id);
  if (!vacancy) notFound();
  const jsonLd = jobPostingJsonLd(vacancy);
  const estimate = estimateSalary(vacancy, await fetchSalaryBenchmarks());

  const posted = new Date(vacancy.first_seen_at ?? vacancy.posted_at ?? vacancy.created_at).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      {!vacancy.archived_at && !isMirrored(vacancy) && jsonLd && (
        <script
          type="application/ld+json"
          // JSON.stringify экранирует строки; "<" заменяем, чтобы текст вакансии не мог закрыть тег
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
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
              {sourceOf(vacancy).badge}
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{vacancy.title}</h1>
            <CompanyLine vacancy={vacancy} className="text-base text-neutral-300" />
            <p className="text-xl font-semibold text-emerald-400 flex flex-wrap items-center gap-3">
              {formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency)}
              {estimate && <SalaryEstimate estimate={estimate} className="text-sm" />}
            </p>
            <p className="flex flex-wrap items-center gap-4 text-sm text-neutral-400">
              {vacancy.city && <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4" />{vacancy.city}</span>}
              {(vacancy.level || vacancy.experience_min != null) && (
                <span className="inline-flex items-center gap-1.5"><Briefcase className="w-4 h-4" />
                  {[vacancy.level && levelLabel(vacancy.level), experienceLabel(vacancy.experience_min)].filter(Boolean).join(" · ")}
                </span>
              )}
              {vacancy.work_format === "remote" || (!vacancy.work_format && vacancy.is_remote)
                ? <span className="inline-flex items-center gap-1.5"><Globe className="w-4 h-4" />Удалённо</span>
                : vacancy.work_format && <span className="inline-flex items-center gap-1.5"><Building2 className="w-4 h-4" />{formatLabel(vacancy.work_format)}</span>}
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4" />{posted}</span>
              {vacancy.source_type === "external" && (vacancy.channels_count ?? 1) > 1 && (
                <span className="inline-flex items-center gap-1.5" title="Одну вакансию часто публикуют в нескольких каналах — мы показываем её один раз">
                  <Megaphone className="w-4 h-4" />в {vacancy.channels_count} {plural(vacancy.channels_count!, ["канале", "каналах", "каналах"])}
                </span>
              )}
            </p>
          </header>

          {vacancy.description && (
            <p className="text-neutral-300 leading-relaxed whitespace-pre-line">{vacancy.description}</p>
          )}

          {vacancy.scope_note && (
            <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <p>
                <span className="font-semibold">Широкий круг задач.</span> {vacancy.scope_note}
                <span className="block text-xs text-amber-200/60 mt-1">Так отметил ИИ FastCV по тексту вакансии — уточните объём работы на собеседовании.</span>
              </p>
            </div>
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
            {!vacancy.archived_at && <ViewCounter vacancyId={vacancy.id} />}
            {vacancy.source_url && (
              <a
                href={vacancy.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-blue-400 transition-colors"
              >
                {sourceOf(vacancy).link === "Пост в Telegram" ? "Оригинальный пост в Telegram" : sourceOf(vacancy).link} <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </footer>
        </article>
      </div>
    </div>
  );
}
