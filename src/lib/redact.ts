// Обезличивание текста перед отправкой в зарубежную модель (Gemini, серверы в США).
//
// В модель уходит только то, что нужно для задачи: опыт, навыки, текст вакансии.
// Имя и отчество, телефоны, email, ссылки, ники в мессенджерах, даты рождения и адреса
// (улица, дом, квартира; город остаётся — он нужен для подбора) заменяем метками — по ним
// человека не найти, а на качество письма, разбора резюме или скрининга они не влияют.
// Где имя нужно в ответе (сопроводительное письмо), модель пишет метку NAME_TOKEN,
// а настоящее имя подставляем уже у себя, после ответа.

export const NAME_TOKEN = "[ИМЯ]";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"'),;]+|\b(?:t\.me|telegram\.me|vk\.com|wa\.me|linkedin\.com|github\.com|hh\.ru\/resume)\/[^\s<>"'),;]+/gi;
// Российские и международные номера: +7 (999) 123-45-67, 8 999 123 45 67, +44 20 7946 0958…
// Зарплаты («150 000 – 200 000») под шаблон не попадают: нужен + или 8/7 в начале и 10–11 цифр подряд с разделителями.
const PHONE = /(?:\+\d{1,3}|(?<!\d)[78])[\s\-–.()]*\d{3}[\s\-–.()]*\d{3}[\s\-–.]*\d{2}[\s\-–.]*\d{2,4}(?!\d)/g;
// Без кода страны: мобильный 999 123-45-67, (999) 1234567, 9991234567 — только с 9 в начале,
// иначе под шаблон попали бы суммы и номера заказов; городской с кодом в скобках (495) 123-45-67;
// местный 123-45-67 — только через дефисы.
const PHONE_LOCAL =
  /(?<![\d+])\(\d{3,5}\)\s*\d{1,3}[\s\-–.]*\d{2}[\s\-–.]*\d{2}(?!\d)|(?<![\d+])\(?9\d{2}\)?[\s\-–.]*\d{3}[\s\-–.]*\d{2}[\s\-–.]*\d{2}(?!\d)|(?<![\d.,\-–])\d{3}-\d{2}-\d{2}(?![\d-])/g;

const MONTHS = "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";
const YEAR_SUFFIX = String.raw`(?:\s*г(?:ода|\.)?)?`;
const FULL_DATE = String.raw`(?:\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}|\d{1,2}\s+(?:${MONTHS})\s+(?:19|20)\d{2}${YEAR_SUFFIX})`;
// Дата рождения с подписью: «Дата рождения: 01.02.1990», «родилась 3 марта 1995 г.», «DOB 1990-…»
const BIRTH_LABELED = new RegExp(
  String.raw`(?:дата\s+рождения|д\.\s?р\.|родил(?:ся|ась)|date\s+of\s+birth|birth\s*date|born|DOB)\s*[:\-–]?\s*${FULL_DATE}`,
  "giu",
);
// «1990 г.р.», «1990 года рождения»
const BIRTH_YEAR = /(?<!\d)(?:19|20)\d{2}\s*(?:г\.\s?р\.?|года\s+рождения)/giu;
// Полная дата (день, месяц, год) с годом до 2010 без подписи — в резюме это почти всегда день рождения.
// Даты работы («09.2019 — н.в.», «март 2015») без дня не трогаем.
const OLD_DATE = new RegExp(
  String.raw`(?<![\d.])(?:\d{1,2}[./-]\d{1,2}[./-](?:19\d{2}|200\d)|\d{1,2}\s+(?:${MONTHS})\s+(?:19\d{2}|200\d)${YEAR_SUFFIX})(?!\d)`,
  "giu",
);

// Адрес: улица (проспект, переулок…) с номером дома, корпусом и квартирой; или «д. 5, кв. 12».
// Город не трогаем: он нужен для подбора вакансий.
const STREET = String.raw`ул\.|улица|пр-т|просп\.|проспект|пер\.|переулок|ш\.|шоссе|б-р|бульвар|наб\.|набережная|пр-д|проезд|мкр\.?|микрорайон`;
const BUILDING = String.raw`(?:,?\s*(?:к\.?|корп\.?|корпус|стр\.|строение)\s*\d+)?`;
const FLAT = String.raw`(?:,?\s*(?:кв\.|квартира|оф\.|офис)\s*\d+)?`;
const ADDRESS = new RegExp(
  String.raw`(?<!\p{L})(?:${STREET})\s*[\p{L}\d][\p{L}\d.\-]*(?:\s+[\p{L}\d.\-]+){0,3}?,?\s*(?:(?:д\.|дом)\s*)?\d+(?:\s?[а-яa-z](?!\d))?(?:\/\d+)?${BUILDING}${FLAT}(?!\d)` +
    String.raw`|(?<!\p{L})(?:д\.|дом)\s*\d+(?:\s?[а-я](?!\d))?${BUILDING},?\s*(?:кв\.|квартира)\s*\d+`,
  "giu",
);

// Отчество во всех падежах: Сергеевич(а, у, ем, е), Сергеевна(ы, е, у, ой), Никитична, Ильич
const PATRONYMIC =
  /(?<!\p{L})\p{Lu}\p{Ll}+(?:ович|евич)(?:а|у|ем|е)?(?!\p{L})|(?<!\p{L})\p{Lu}\p{Ll}+(?:овн|евн|ичн)(?:а|ы|е|у|ой)(?!\p{L})|(?<!\p{L})\p{Lu}\p{Ll}*ьич(?:а|у|ем|е)?(?!\p{L})/gu;
const HANDLE = /(?<![\p{L}\p{N}@._-])@[A-Za-z][A-Za-z0-9_]{3,31}\b/gu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VOWEL_END = /[аяеиоуыьй]$/iu;

/**
 * Шаблон для частей имени с окончаниями падежей: «Данила» → «Данилы», «Даниле»
 * («Данил» + до трёх букв); «Анна» → «Анне», «Анной»; «Олег» → «Олега», «Олегом».
 * Части из трёх букв («Лев», «Ким») — только как есть, иначе заденем обычные слова.
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
    .map(p => {
      if (p.length >= 5 || (p.length === 4 && VOWEL_END.test(p))) return `${escape(p.slice(0, -1))}\\p{L}{0,3}`;
      if (p.length === 4) return `${escape(p)}\\p{L}{0,2}`;
      return escape(p);
    });
  return new RegExp(`(?<!\\p{L})(?:${alternatives.join("|")})(?!\\p{L})`, "giu");
}

const NAME_RUN = new RegExp(`${escape(NAME_TOKEN)}(?:\\s+${escape(NAME_TOKEN)})+`, "g");

/**
 * Текст без имени, контактов, дат рождения и адресов.
 * names — известные имена человека (из профиля, первой строки резюме).
 */
export function redactPersonal(text: string, names: (string | null | undefined)[] = []): string {
  let out = text
    .replace(EMAIL, "[email]")
    .replace(URL, "[ссылка]")
    .replace(BIRTH_LABELED, "[дата рождения]")
    .replace(BIRTH_YEAR, "[дата рождения]")
    .replace(OLD_DATE, "[дата рождения]")
    .replace(PHONE, "[телефон]")
    .replace(PHONE_LOCAL, "[телефон]")
    .replace(ADDRESS, "[адрес]")
    .replace(HANDLE, "[контакт]")
    .replace(PATRONYMIC, NAME_TOKEN);
  const pattern = namePattern(names.filter((n): n is string => typeof n === "string"));
  if (pattern) out = out.replace(pattern, NAME_TOKEN);
  // «Иванов Иван Сергеевич» → одна метка, а не три подряд
  return out.replace(NAME_RUN, NAME_TOKEN);
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
