import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { profile, vacancy } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 500 });
    }

    const prompt = `
Ты профессиональный IT-копирайтер. Твоя задача — написать лаконичное сопроводительное письмо (до 3 абзацев) для отклика на вакансию.

ДАННЫЕ КАНДИДАТА:
Имя: ${profile.name}
Опыт и навыки: ${profile.experience}, стек: ${profile.skills.join(", ")}

ДАННЫЕ ВАКАНСИИ:
Название: ${vacancy.title}
Описание: ${vacancy.description}

Требования к письму:
1. Без воды, клише и заискивания. Уверенный, но вежливый тон.
2. Подчеркни ровно те навыки кандидата, которые пересекаются с вакансией.
3. Не придумывай опыт, которого нет в профиле.
4. Верни только текст письма, без дополнительных комментариев.
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Не удалось сгенерировать текст.";

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}