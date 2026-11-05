// Обезличивание текста перед отправкой в зарубежную модель (Gemini, серверы в США).
//
// В модель уходит только то, что нужно для задачи: опыт, навыки, текст вакансии.
// Имя, телефоны, email, ссылки и ники в мессенджерах заменяем метками — по ним
// человека не найти, а на качество письма, разбора резюме или скрининга они не влияют.
// Где имя нужно в ответе (сопроводительное письмо), модель пишет метку NAME_TOKEN,
// а настоящее имя подставляем уже у себя, после ответа.

export const NAME_TOKEN = "[ИМЯ]";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"'),;]+|\b(?:t\.me|telegram\.me|vk\.com|wa\.me|linkedin\.com|github\.com|hh\.ru\/resume)\/[^\s<>"'),;]+/gi;
// Российские и международные номера: +7 (999) 123-45-67, 8 999 123 45 67, +44 20 7946 0958…
// Зарплаты («150 000 – 200 000») под шаблон не попадают: нужен + или 8/7 в начале и 10–11 цифр подряд с разделителями.
const PHONE = /(?:\+\d{1,3}|(?<!\d)[78])[\s\-–.()]*\d{3}[\s\-–.()]*\d{3}[\s\-–.]*\d{2}[\s\-–.]*\d{2,4}(?!\d)/g;
const HANDLE = /(?<![\p{L}\p{N}@._-])@[A-Za-z][A-Za-z0-9_]{3,31}\b/gu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Шаблон для частей имени. Для длинных частей разрешаем окончания падежей
 * («Данила» → «Данилы», «Даниле»): «Данил» + до трёх букв.
 */
function namePattern(names: string[]): RegExp | null {
  const parts = new Set<string>();
  for (const name of names) {
    for (const part of name.split(/[\s,.]+/)) {
      if (part.length >= 3 && /^\p{L}[\p{L}-]*$/u.test(part)) parts.add(part);
    }
  }
  if (!parts.size) return null;
  const alternatives = [...parts]
    .sort((a, b) => b.length - a.length)
    .map(p => (p.length >= 5 ? `${escape(p.slice(0, -1))}\\p{L}{0,3}` : escape(p)));
  return new RegExp(`(?<!\\p{L})(?:${alternatives.join("|")})(?!\\p{L})`, "giu");
}

/** Текст без имени, контактов и ссылок. names — известные имена (из профиля, первой строки резюме). */
export function redactPersonal(text: string, names: string[] = []): string {
  let out = text
    .replace(EMAIL, "[email]")
    .replace(URL, "[ссылка]")
    .replace(PHONE, "[телефон]")
    .replace(HANDLE, "[контакт]");
  const pattern = namePattern(names);
  if (pattern) out = out.replace(pattern, NAME_TOKEN);
  return out;
}

/**
 * Имя из начала резюме: первая непустая строка из 2–3 слов с заглавной буквы
 * («Иванов Иван Сергеевич», «Ivan Petrov»). Иначе null — тогда имя заполнит сам кандидат.
 */
export function nameFromResume(text: string): string | null {
  for (const raw of text.split("\n").slice(0, 5)) {
    const line = raw.trim();
    if (!line) continue;
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 3 && words.every(w => /^\p{Lu}[\p{Ll}-]+$/u.test(w))) return line;
  }
  return null;
}

/** Метка имени в ответе модели → настоящее имя. */
export const restoreName = (text: string, name: string) => text.split(NAME_TOKEN).join(name);
