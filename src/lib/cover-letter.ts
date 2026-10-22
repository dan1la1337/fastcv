// Запасное сопроводительное письмо, когда ИИ недоступен (перегрузка Gemini, демо без сети).
// Только данные из профиля и вакансии — ничего не придумываем.

export interface LetterProfile {
  name: string;
  description: string;
  skills: string[];
}

export interface LetterVacancy {
  title: string;
  company_name?: string | null;
  description?: string | null;
  stack?: string[] | null;
}

/** Навыки кандидата, которые упоминаются в вакансии (без учёта регистра). */
export function matchingSkills(skills: string[], vacancy: LetterVacancy): string[] {
  const stack = (vacancy.stack ?? []).map(s => s.toLowerCase());
  const text = `${vacancy.title} ${vacancy.description ?? ""}`.toLowerCase();
  return skills.filter(skill => {
    const s = skill.trim().toLowerCase();
    return s.length > 1 && (stack.includes(s) || text.includes(s));
  });
}

/** Первые одно-два предложения «О себе», не длиннее 300 символов. */
function aboutLine(description: string): string | null {
  const text = description.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [text];
  let line = "";
  for (const sentence of sentences.slice(0, 2)) {
    if ((line + sentence).length > 300) break;
    line += sentence;
  }
  return (line || text.slice(0, 300)).trim();
}

export function templateLetter(profile: LetterProfile, vacancy: LetterVacancy): string {
  const name = profile.name.trim();
  const where = vacancy.company_name ? ` в ${vacancy.company_name}` : "";
  const matched = matchingSkills(profile.skills, vacancy);
  const about = aboutLine(profile.description);

  const paragraphs = [
    "Здравствуйте!",
    `${name ? `Меня зовут ${name}. ` : ""}Откликаюсь на вакансию «${vacancy.title}»${where}.`,
  ];
  if (matched.length) {
    paragraphs.push(`Мой опыт пересекается с вашими требованиями: ${matched.slice(0, 8).join(", ")}.`);
  } else if (profile.skills.length) {
    paragraphs.push(`Мои ключевые навыки: ${profile.skills.slice(0, 8).join(", ")}.`);
  }
  if (about) paragraphs.push(`Коротко обо мне: ${about}`);
  paragraphs.push("Предлагаю обсудить детали на собеседовании. Спасибо за внимание!");
  if (name) paragraphs.push(`С уважением,\n${name}`);
  return paragraphs.join("\n\n");
}
