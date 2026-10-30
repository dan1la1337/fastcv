import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AlertTriangle, ArrowLeft, Calendar, ChevronRight, ExternalLink, Ghost, MessagesSquare } from "lucide-react";
import ClosedReport from "@/components/ClosedReport";
import { supabase } from "@/lib/supabase";
import { VACANCY_COLUMNS, formatLabel, formatSalary, levelLabel, experienceLabel, plural, sourceOf, ghostSignal, type Vacancy } from "@/lib/vacancies";
import VacancyApply from "@/components/VacancyApply";
import VacancyMatch from "@/components/VacancyMatch";
import MobileApplyBar from "@/components/MobileApplyBar";
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

// Вакансии из API других площадок: живут несколько часов или дней и повторяют оригинал
const isMirrored = (v: { source_url?: string | null }) =>
  Boolean(v.source_url && !/^https?:\/\/t\.me\//.test(v.source_url));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const vacancy = await getVacancy((await params).id);
  if (!vacancy) return { title: "Вакансия не найдена — FastCV" };
  return {
    title: `${vacancy.title}${vacancy.company_name ? ` в ${vacancy.company_name}` : ""} — FastCV`,
    description: summary(vacancy),
    alternates: { canonical: `/vacancy/${vacancy.id}` },
    openGraph: { title: vacancy.title, description: summary(vacancy), type: "article" },
    // В поиск не попадают архивные вакансии (открываются по старым ссылкам) и вакансии
    // «Работы России» и SuperJob: живут недолго и повторяют оригинал — в выдаче были бы дубли и 404
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

  const remote = vacancy.work_format === "remote" || (!vacancy.work_format && vacancy.is_remote);
  const format = remote ? "Удалённо" : formatLabel(vacancy.work_format);
  const experience = [vacancy.level && levelLabel(vacancy.level), experienceLabel(vacancy.experience_min)].filter(Boolean).join(" · ");
  const tiles = [
    { label: "Зарплата", value: formatSalary(vacancy.salary_min, vacancy.salary_max, vacancy.salary_currency), estimate: true },
    experience && { label: "Опыт", value: experience },
    (format || vacancy.city) && { label: "Где", value: [format, vacancy.city].filter(Boolean).join(" · ") },
  ].filter(Boolean) as { label: string; value: string; estimate?: boolean }[];
  const channels = vacancy.source_type === "external" ? vacancy.channels_count ?? 1 : 0;
  const ghost = vacancy.archived_at ? null : ghostSignal(vacancy);

  return (
    <div className="min-h-screen text-neutral-100 font-sans">
      {!vacancy.archived_at && !isMirrored(vacancy) && jsonLd && (
        <script
          type="application/ld+json"
          // JSON.stringify экранирует строки; "<" заменяем, чтобы текст вакансии не мог закрыть тег
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" /> К ленте
        </Link>

        {vacancy.archived_at && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Вакансия в архиве: скорее всего, она уже закрыта.
          </div>
        )}

        {ghost && (
          <div className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <Ghost className="w-5 h-5 text-amber-300 shrink-0" aria-hidden="true" />
            <p><span className="font-semibold">Возможно, вакансия неактуальна.</span> {ghost}. Перед откликом уточните у работодателя.</p>
          </div>
        )}

        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-[999_1_560px] min-w-0 space-y-4">
            <article className="glass rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`px-3 py-1 rounded-full ${vacancy.source_type === "internal" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.08] text-neutral-300"}`}>
                  {sourceOf(vacancy).badge}
                </span>
                <span className="px-3 py-1 rounded-full bg-teal-300/15 text-teal-200 inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Впервые — {posted}
                  {channels > 1 && <> · в {channels} {plural(channels, ["канале", "каналах", "каналах"])}</>}
                </span>
              </div>
              <h1 className="font-display text-2xl sm:text-[32px] leading-tight font-bold text-white">{vacancy.title}</h1>
              <CompanyLine vacancy={vacancy} className="text-base text-neutral-300" />

              {tiles.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
                  {tiles.map(t => (
                    <div key={t.label} className="rounded-2xl px-4 py-3 bg-white/[0.04] border border-white/[0.08]">
                      <p className="text-xs text-neutral-500">{t.label}</p>
                      <p className="mt-1 font-semibold text-white">{t.value}</p>
                      {t.estimate && estimate && <SalaryEstimate estimate={estimate} className="text-xs mt-1" />}
                    </div>
                  ))}
                </div>
              )}

              {vacancy.description && (
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-white">О вакансии</h2>
                  <p className="text-neutral-300 leading-relaxed whitespace-pre-line">{vacancy.description}</p>
                </div>
              )}

              {vacancy.scope_note && (
                <div className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
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
                    <span key={tech} className="text-xs px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-neutral-300">{tech}</span>
                  ))}
                </div>
              )}

              <footer className="flex flex-wrap items-center gap-4 pt-4 border-t border-white/10">
                {vacancy.source_url && (
                  <a
                    href={vacancy.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-200 hover:text-white transition-colors"
                  >
                    {sourceOf(vacancy).link === "Пост в Telegram" ? "Оригинальный пост в Telegram" : sourceOf(vacancy).link} <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                {!vacancy.archived_at && <ViewCounter vacancyId={vacancy.id} />}
                {!vacancy.archived_at && <span className="ml-auto"><ClosedReport vacancyId={vacancy.id} /></span>}
              </footer>
            </article>

            {!vacancy.archived_at && <VacancyMatch vacancyId={vacancy.id} />}

            {!vacancy.archived_at && (
              <Link href={`/practice/${vacancy.id}`}
                className="glass rounded-3xl p-5 flex items-center gap-4 group hover:border-teal-300/40 transition-colors">
                <span className="shrink-0 w-11 h-11 rounded-2xl bg-teal-300/10 text-teal-300 inline-flex items-center justify-center">
                  <MessagesSquare className="w-5 h-5" aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-white">Тренажёр собеседования</span>
                  <span className="block text-sm text-neutral-400">ИИ задаст вопросы по этой вакансии, оценит ответы и подскажет, как сделать их сильнее</span>
                </span>
                <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-teal-300" aria-hidden="true" />
              </Link>
            )}
          </div>

          {!vacancy.archived_at && (
            <div id="smart-apply" className="flex-[1_1_360px] lg:max-w-md min-w-0 lg:sticky lg:top-24 scroll-mt-6">
              <VacancyApply vacancy={vacancy} />
            </div>
          )}
        </div>
      </div>

      {/* На телефоне панель Smart Apply ниже текста — кнопка внизу экрана ведёт к ней */}
      {!vacancy.archived_at && <MobileApplyBar target="smart-apply" />}
    </div>
  );
}
