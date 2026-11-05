// Только для серверного кода: запрос к Gemini с перебором моделей.

// Тот же порядок, что и в сборщике вакансий (main.py)
export const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash"];
const MODEL_TIMEOUT_MS = 20_000;

/**
 * Ответ первой ответившей модели или null. Инструкция — в system_instruction,
 * пользовательские данные — отдельным сообщением, чтобы они не выдавали себя за указания.
 */
export async function geminiText(
  apiKey: string,
  instruction: string,
  input: string,
  options: { temperature?: number; maxOutputTokens?: number; json?: boolean } = {},
): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: input }] }],
          generationConfig: {
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.maxOutputTokens ?? 600,
            ...(options.json && { responseMimeType: "application/json" }),
          },
        }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error("Gemini error", model, response.status, (await response.text()).slice(0, 300));
        if (![404, 429].includes(response.status) && response.status < 500) return null;
        continue;
      }
      const data = await response.json();
      const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text?.trim()) return text.trim();
    } catch (error) {
      console.error("Gemini request failed", model, error);
    }
  }
  return null;
}
