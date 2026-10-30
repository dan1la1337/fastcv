// Чат кандидата и работодателя: типы и форматирование (без обращений к базе).
import { isNetworkError } from "@/lib/auth-errors";

export type Conversation = {
  id: string;
  application_id: string | null;
  vacancy_id: string | null;
  vacancy_title: string;
  other_name: string;
  i_am: string;
  status: string | null;
  last_body: string | null;
  last_kind: string | null;
  last_mine: boolean | null;
  last_message_at: string;
  unread: number;
  other_read_at: string | null;
};

export type Message = {
  id: number;
  sender_id: string | null;
  kind: "text" | "application" | "status" | string;
  body: string;
  meta: { vacancy_id?: string; vacancy_title?: string; blitz?: { q: string; a: string }[]; status?: string } | null;
  created_at: string;
};

export const MESSAGE_MAX = 4000;
export const MESSAGE_COLUMNS = "id, sender_id, kind, body, meta, created_at";

/** «14:05», «вчера», «12 окт.» — для списка диалогов. */
export function shortTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

/** Подпись-разделитель между днями в ленте сообщений. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const t = shortTime(iso, now);
  if (/^\d\d:\d\d$/.test(t)) return "Сегодня";
  if (t === "вчера") return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

/** Превью последнего сообщения в списке. */
export function preview(c: Pick<Conversation, "last_body" | "last_kind" | "last_mine" | "i_am">): string {
  if (c.last_kind === "application") return c.i_am === "candidate" ? "Вы откликнулись на вакансию" : "Новый отклик на вакансию";
  if (c.last_kind === "offer" && c.i_am === "candidate") return "Работодатель предлагает вакансию";
  if (!c.last_body) return "";
  return (c.last_mine ? "Вы: " : "") + c.last_body.replace(/\s+/g, " ");
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Текст сообщения на части: обычный текст и ссылки (только http/https). */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Ошибка базы «chat: …» → понятный текст. */
export function chatErrorText(message: string): string {
  const m = message.match(/chat: (.+)/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ".";
  if (isNetworkError(message)) return "Нет связи с сервером. Сообщение не отправлено — попробуйте ещё раз.";
  return "Не удалось отправить сообщение. Попробуйте ещё раз.";
}
