import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFile, isLink, slotRange, slotsErrorText, toLocalInput, zoneLabel } from "@/lib/interviews";

// Форматирование времени зависит от часового пояса машины — фиксируем Москву
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "Europe/Moscow"; });
afterAll(() => { process.env.TZ = originalTz; });

const event = {
  id: "slot-1",
  title: "Собеседование: Python, Acme",
  startsAt: "2026-11-20T12:00:00Z",
  minutes: 45,
  place: "https://meet.example.com/abc",
  details: "Вопросы; ссылка, план\nвторая строка",
};

describe("icsFile", () => {
  const ics = icsFile(event, new Date("2026-11-18T09:30:00.123Z"));
  const lines = ics.split("\r\n");

  it("is a CRLF iCalendar with start, end and a 30-minute reminder", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:slot-1@fastcv.ru");
    expect(lines).toContain("DTSTAMP:20261118T093000Z");
    expect(lines).toContain("DTSTART:20261120T120000Z");
    expect(lines).toContain("DTEND:20261120T124500Z");
    expect(lines).toContain("TRIGGER:-PT30M");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes commas, semicolons and newlines", () => {
    expect(lines).toContain("SUMMARY:Собеседование: Python\\, Acme");
    expect(lines).toContain("DESCRIPTION:Вопросы\\; ссылка\\, план\\nвторая строка");
  });

  it("adds URL only for a link place", () => {
    expect(lines).toContain("URL:https://meet.example.com/abc");
    const office = icsFile({ ...event, place: "Офис, 3 этаж" }).split("\r\n");
    expect(office).toContain("LOCATION:Офис\\, 3 этаж");
    expect(office.some(l => l.startsWith("URL:"))).toBe(false);
    const nowhere = icsFile({ ...event, place: null, details: undefined }).split("\r\n");
    expect(nowhere.some(l => l.startsWith("LOCATION:") || l.startsWith("DESCRIPTION:Вопросы"))).toBe(false);
  });
});

describe("googleCalendarUrl", () => {
  it("passes title, UTC dates, details and place", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe("20261120T120000Z/20261120T124500Z");
    expect(url.searchParams.get("location")).toBe(event.place);
    expect(url.searchParams.get("details")).toBe(event.details);
  });

  it("omits empty details and place", () => {
    const url = new URL(googleCalendarUrl({ ...event, place: null, details: undefined }));
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.has("details")).toBe(false);
  });
});

describe("isLink", () => {
  it.each([
    ["https://zoom.us/j/1", true], ["  http://x.ru/a  ", true], ["Офис https://x.ru", false],
    ["zoom.us/j/1", false], ["", false], [null, false], [undefined, false],
  ])("%j → %s", (place, expected) => {
    expect(isLink(place)).toBe(expected);
  });
});

describe("time formatting", () => {
  it("formats the slot range in the user's time zone", () => {
    expect(slotRange("2026-11-20T12:00:00Z", 90)).toBe("15:00–16:30");
  });

  it("formats a datetime-local value", () => {
    expect(toLocalInput(new Date("2026-03-05T06:07:00Z"))).toBe("2026-03-05T09:07");
  });

  it("labels the time zone", () => {
    expect(zoneLabel(new Date("2026-11-20T12:00:00Z"))).toMatch(/^(GMT|UTC)\+3$|^MSK$/);
  });
});

describe("slotsErrorText", () => {
  it("turns a database error into a sentence", () => {
    expect(slotsErrorText('ERROR: slots: слот уже занят')).toBe("Слот уже занят.");
  });

  it("falls back to a generic message", () => {
    expect(slotsErrorText("network error")).toBe("Не получилось. Попробуйте ещё раз.");
  });
});
