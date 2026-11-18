import { expect, test } from "@playwright/test";
import { mergeMessages, pollCursor, type Message } from "../src/lib/chat";

// Курсор опроса чата (#142): без браузера, только логика ленты.
const msg = (id: number, sender: string): Message =>
  ({ id, sender_id: sender, kind: "text", body: `#${id}`, meta: null, created_at: "2026-11-18T00:00:00Z" });

test("входящее 11 → собственное 12 → опрос: оба сообщения в ленте, без дублей", ({ isMobile }) => {
  test.skip(isMobile, "логика без страницы");
  const db = [msg(10, "other"), msg(11, "other"), msg(12, "me")];
  const fetchAfter = (cursor: number) => db.filter(m => m.id > cursor);

  // Загружено до ID 10
  let shown = mergeMessages(null, [db[0]]);
  let cursor = pollCursor(0, shown);

  // Собеседник записал 11, пользователь отправил 12 до следующего опроса
  shown = mergeMessages(shown, [db[2]]);
  expect(shown.map(m => m.id)).toEqual([10, 12]);

  // Опрос
  const fresh = fetchAfter(cursor);
  cursor = pollCursor(cursor, fresh);
  shown = mergeMessages(shown, fresh);

  expect(shown.map(m => m.id)).toEqual([10, 11, 12]);
  expect(cursor).toBe(12);
  expect(fetchAfter(cursor)).toEqual([]);
});

test("пустой ответ опроса не сдвигает курсор", ({ isMobile }) => {
  test.skip(isMobile, "логика без страницы");
  expect(pollCursor(7, [])).toBe(7);
});
