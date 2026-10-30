// Запись на собеседование: типы, форматирование времени и событие для календаря.

export type Slot = {
  id: string;
  conversation_id: string;
  starts_at: string;
  duration_min: number;
  place: string | null;
  status: "open" | "booked" | "withdrawn" | "cancelled" | string;
};

export const SLOT_COLUMNS = "id, conversation_id, starts_at, duration_min, place, status";
export const MAX_SLOTS = 6;
export const DURATIONS = [30, 45, 60, 90, 120];

/** «пн, 3 ноября, 15:00» в часовом поясе пользователя. */
export function slotLabel(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** «15:00–16:00» */
export function slotRange(iso: string, minutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + minutes * 60_000);
  const t = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${t(start)}–${t(end)}`;
}

/** Часовой пояс пользователя для подписи: «GMT+3». */
export function zoneLabel(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZoneName: "short" }).formatToParts(date)
    .find(p => p.type === "timeZoneName")?.value ?? "";
}

/** Ссылка ли «место» (звонок) — тогда показываем кнопкой. */
export const isLink = (place: string | null | undefined) => !!place && /^https?:\/\/\S+$/i.test(place.trim());

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

export type CalendarEvent = { id: string; title: string; startsAt: string; minutes: number; place?: string | null; details?: string };

/** Событие iCalendar (.ics) — открывается в Google, Apple и Outlook календарях. */
export function icsFile(e: CalendarEvent, now: Date = new Date()): string {
  const start = new Date(e.startsAt);
  const end = new Date(start.getTime() + e.minutes * 60_000);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FastCV//Interview//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@fastcv.ru`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.place ? [`LOCATION:${icsText(e.place)}`] : []),
    ...(isLink(e.place) ? [`URL:${e.place!.trim()}`] : []),
    ...(e.details ? [`DESCRIPTION:${icsText(e.details)}`] : []),
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

/** Ссылка «добавить в Google Календарь». */
export function googleCalendarUrl(e: CalendarEvent): string {
  const start = new Date(e.startsAt);
  const end = new Date(start.getTime() + e.minutes * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE", text: e.title, dates: `${icsDate(start)}/${icsDate(end)}`,
    ...(e.details && { details: e.details }), ...(e.place && { location: e.place }),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function downloadIcs(e: CalendarEvent) {
  const url = URL.createObjectURL(new Blob([icsFile(e)], { type: "text/calendar;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "fastcv-interview.ics" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Значение для <input type="datetime-local"> в часовом поясе пользователя. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ошибка базы «slots: …» → понятный текст. */
export function slotsErrorText(message: string): string {
  const m = message.match(/slots: (.+)/);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + "." : "Не получилось. Попробуйте ещё раз.";
}
