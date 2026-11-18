// Ошибки загрузки в кабинетах: показать пользователю, а не выдать за пустые данные.

/** Ошибки загрузки данных: [что грузили, ошибка] → текст или null, если всё загрузилось. */
export function loadErrorText(parts: [string, { message: string } | null][]): string | null {
  const failed = parts.filter(([, e]) => e);
  if (!failed.length) return null;
  return "Не удалось загрузить: " + failed.map(([what, e]) => `${what} (${e!.message})`).join(", ") + ". Обновите страницу.";
}

/** Отказ в доступе (Postgres 42501): не администратор или не вошёл. Остальные ошибки — сбой загрузки. */
export function isAccessDenied(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}
