import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DIRECTIONS, plural } from "@/lib/vacancies";
import TelegramBotSetup from "@/components/TelegramBotSetup";
import ChannelOptOut, { type ExcludedChannel } from "@/components/ChannelOptOut";

export const metadata: Metadata = { title: "Метрики — FastCV", robots: { index: false } };

interface Metrics {
  generated_at: string;
  vacancies_active: number;
  vacancies_total: number;
  vacancies_by_day: { day: string; external: number; internal: number }[];
  by_direction: { direction: string; count: number }[] | null;
  channels_week: { channel: string; count: number }[] | null;
  channels_active: number;
  users_total: number;
  candidates: number;
  employers: number;
  users_week: number;
  profiles_with_prefs: number;
  applications_total: number;
  applications_week: number;
  invitations_total: number;
  views_total: number;
  letters_week: number;
  ai_calls_week: number;
}

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");
const fmt = (n: number) => n.toLocaleString("ru-RU");
const directionLabel = (id: string) => DIRECTIONS.find(d => d.id === id)?.label ?? id;

/**
 * Метрики продукта для владельца (план, 4.1): вакансии по дням, источники,
 * пользователи, отклики и конверсия. Данные считает функция admin_metrics(),
 * которая отказывает всем, кроме администраторов из таблицы app_admins.
 */
export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_metrics");
  // Не администратор — страницы для него не существует
  if (error || !data) notFound();
  const m = data as unknown as Metrics;
  const { data: botSetting } = await supabase.from("app_settings").select("value").eq("key", "telegram_bot_username").maybeSingle();
  const { data: excluded } = await supabase.rpc("excluded_channels");

  const days = m.vacancies_by_day ?? [];
  const totals = days.map(d => d.external + d.internal);
  const maxDay = Math.max(1, ...totals);
  const peak = totals.indexOf(Math.max(...totals));
  const weekVacancies = totals.slice(-7).reduce((a, b) => a + b, 0);
  const directions = m.by_direction ?? [];
  const maxDirection = Math.max(1, ...directions.map(d => d.count));

  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Вакансий в ленте", value: fmt(m.vacancies_active), note: `${fmt(weekVacancies)} новых за 7 дней` },
    { label: "Пользователей", value: fmt(m.users_total), note: `${m.candidates} кандидатов · ${m.employers} работодателей · +${m.users_week} за неделю` },
    { label: "Откликов", value: fmt(m.applications_total), note: `+${m.applications_week} за неделю · ${m.invitations_total} приглашений` },
    { label: "Просмотр → отклик", value: percent(m.applications_total, m.views_total), note: `${fmt(m.views_total)} просмотров вакансий` },
    { label: "Профилей с предпочтениями", value: percent(m.profiles_with_prefs, m.candidates), note: `${m.profiles_with_prefs} из ${m.candidates} кандидатов` },
    { label: "Писем от ИИ за неделю", value: fmt(m.letters_week), note: `${fmt(m.ai_calls_week)} вызовов ИИ всего` },
  ];

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
              <ArrowLeft className="w-4 h-4" /> На сайт
            </Link>
            <h1 className="text-2xl font-bold mt-2">Метрики FastCV</h1>
          </div>
          <p className="text-xs text-neutral-500">
            Обновлено {new Date(m.generated_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })} МСК ·
            {" "}{m.channels_active} {plural(m.channels_active, ["канал", "канала", "каналов"])}
          </p>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Ключевые показатели">
          {tiles.map(t => (
            <div key={t.label} className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
              <p className="text-xs text-neutral-400">{t.label}</p>
              <p className="text-3xl font-bold mt-1 tabular-nums">{t.value}</p>
              {t.note && <p className="text-xs text-neutral-500 mt-1">{t.note}</p>}
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-4">
          <h2 className="text-sm font-semibold">Новые вакансии по дням, последние 14 дней</h2>
          <div className="flex items-end gap-[2px] h-44" role="img"
            aria-label={`Новые вакансии по дням: максимум ${totals[peak] ?? 0} за день`}>
            {days.map((d, i) => {
              const total = totals[i];
              const date = new Date(d.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
              return (
                <div key={d.day} className="group relative flex-1 h-full flex flex-col justify-end">
                  {i === peak && total > 0 && (
                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[11px] text-neutral-300 tabular-nums">{total}</span>
                  )}
                  <div
                    className="w-full rounded-t-[4px] bg-teal-300 group-hover:bg-teal-200 transition-colors"
                    style={{ height: `${Math.max(total ? 2 : 0, (total / maxDay) * 85)}%` }}
                    title={`${date}: ${total} (из каналов ${d.external}, от работодателей ${d.internal})`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] text-neutral-500">
            <span>{days[0] && new Date(days[0].day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
            <span>сегодня</span>
          </div>
          <details className="text-xs text-neutral-400">
            <summary className="cursor-pointer">Таблица</summary>
            <table className="mt-2 w-full tabular-nums">
              <thead><tr className="text-left text-neutral-500"><th className="py-1">День</th><th>Из каналов</th><th>От работодателей</th></tr></thead>
              <tbody>
                {days.map(d => (
                  <tr key={d.day} className="border-t border-neutral-800">
                    <td className="py-1">{new Date(d.day).toLocaleDateString("ru-RU")}</td><td>{d.external}</td><td>{d.internal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-3">
            <h2 className="text-sm font-semibold">Вакансии в ленте по направлениям</h2>
            <ul className="space-y-2">
              {directions.map(d => (
                <li key={d.direction} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-xs">
                  <span className="text-neutral-300 truncate">{directionLabel(d.direction)}</span>
                  <span className="h-2.5 rounded-r-[4px] bg-teal-300" style={{ width: `${(d.count / maxDirection) * 100}%` }} />
                  <span className="text-neutral-400 tabular-nums text-right">{d.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-3">
            <h2 className="text-sm font-semibold">Источники за 7 дней</h2>
            {m.channels_week?.length ? (
              <table className="w-full text-xs tabular-nums">
                <thead><tr className="text-left text-neutral-500"><th className="py-1">Канал</th><th className="text-right">Вакансий</th><th className="text-right">Доля</th></tr></thead>
                <tbody>
                  {m.channels_week.map(c => (
                    <tr key={c.channel} className="border-t border-neutral-800">
                      <td className="py-1.5">
                        <a href={`https://t.me/${c.channel}`} target="_blank" rel="noreferrer" className="text-neutral-300 hover:text-teal-300">@{c.channel}</a>
                      </td>
                      <td className="text-right text-neutral-300">{c.count}</td>
                      <td className="text-right text-neutral-500">{percent(c.count, weekVacancies)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-xs text-neutral-500">За неделю вакансий из каналов не было.</p>}
          </section>
        </div>
        <TelegramBotSetup current={botSetting?.value ?? null} />
        <ChannelOptOut initial={(excluded ?? []) as ExcludedChannel[]} />
      </div>
    </main>
  );
}
