// Защита генерации ИИ от текста, который пытается командовать моделью (prompt injection),
// и проверка того, что модель вернула.

/** Убираем из пользовательского текста наши служебные теги, чтобы из блока данных нельзя было «выйти». */
export const fence = (value: string) => value.replace(/<\/?\s*(candidate|vacancy|answers|question|answer)[^>]*>/gi, "");

/**
 * Проверка ответа модели: письмо — обычный текст разумной длины. Ссылки оставляем
 * только те, что есть в исходных данных: модель не должна подсовывать кандидату чужие адреса.
 */
export function sanitizeLetter(text: string, source: string): string {
  // Знаки препинания в конце не часть адреса: «…/job.» сверяем как «…/job» и точку оставляем
  const withoutForeignLinks = text.replace(/https?:\/\/[^\s)<>"']+/gi, match => {
    const url = match.replace(/[.,;:!?]+$/, "");
    return (source.includes(url) ? url : "") + match.slice(url.length);
  });
  return withoutForeignLinks.replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
}
