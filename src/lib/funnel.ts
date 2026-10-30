// Прозрачность воронки для кандидата: данные my_application_funnel → строки для карточки отклика.
import { hoursLabel } from "@/lib/rating";

export type Funnel = {
  application_id: string;
  total: number;
  place_in_line: number;
  match_score: number | null;
  match_rank: number | null;
  better_than: number | null;
  viewed: number;
  answered: number;
  employer_active_at: string | null;
  reply_hours: number | null;
  reply_rate: number | null;
};

export type FunnelView = {
  queue: string;
  match: string | null;
  activity: string;
  reply: string | null;
  /** совпадение ниже большинства — подсказать, как поднять */
  weak: boolean;
};

/** «сегодня», «вчера», «3 дня назад». */
export function agoLabel(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / 864e5);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  const n10 = days % 10, n100 = days % 100;
  const word = n100 >= 11 && n100 <= 14 ? "дней" : n10 === 1 ? "день" : n10 >= 2 && n10 <= 4 ? "дня" : "дней";
  return `${days} ${word} назад`;
}

export function funnelView(f: Funnel, createdAt: string, now: number): FunnelView {
  const others = f.total - 1;
  const queue = others <= 0
    ? "Вы откликнулись первым — других откликов пока нет"
    : `Откликов на вакансию: ${f.total} · ваш — ${f.place_in_line}-й по времени`;
  const match = f.match_rank && f.total > 1
    ? `По совпадению с вакансией — ${f.match_rank}-е место из ${f.total}`
      + (f.better_than !== null ? ` (выше, чем у ${f.better_than}% откликов)` : "")
      + ". Работодатель по умолчанию видит отклики в этом порядке"
    : null;
  const activity = `Работодатель открыл ${f.viewed} из ${f.total}`
    + (f.employer_active_at ? ` · заходил ${agoLabel(f.employer_active_at, now)}` : " · ещё не заходил");
  let reply: string | null = null;
  if (f.reply_hours) {
    const due = new Date(Date.parse(createdAt) + f.reply_hours * 36e5);
    reply = `Обычно отвечает ${hoursLabel(f.reply_hours)}`
      + (f.reply_rate !== null ? ` и на ${f.reply_rate}% откликов` : "")
      + (due.getTime() > now ? ` — ответ можно ждать к ${due.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : "");
  } else if (f.reply_rate !== null) {
    reply = `Отвечает на ${f.reply_rate}% откликов`;
  }
  return { queue, match, activity, reply, weak: f.better_than !== null && f.better_than < 50 };
}
