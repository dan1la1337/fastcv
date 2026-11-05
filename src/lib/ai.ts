// Только для серверного кода: запрос к языковой модели в Yandex AI Studio.
//
// Данные пользователей (профили, резюме, отклики) обрабатываются только на серверах в России:
// открытые модели (Qwen3, DeepSeek и др.) берём из Yandex AI Studio, а не из зарубежных API.
// Так нет трансграничной передачи персональных данных (ст. 12 152-ФЗ).
//
// Переменные окружения:
//   YANDEX_API_KEY   — API-ключ сервисного аккаунта (роль ai.languageModels.user);
//   YANDEX_FOLDER_ID — идентификатор каталога Yandex Cloud;
//   YANDEX_AI_MODELS — необязательно: модели через запятую, по порядку перебора.

const ENDPOINT = "https://llm.api.cloud.yandex.net/v1/chat/completions";
export const DEFAULT_AI_MODELS = ["qwen3-235b-a22b-fp8/latest", "yandexgpt/latest"];
const MODEL_TIMEOUT_MS = 25_000;

export interface AiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  /** Ответ нужен JSON-объектом: просим модель отвечать без markdown, разбирает вызывающий код. */
  json?: boolean;
  timeoutMs?: number;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID);
}

function models(folder: string): string[] {
  const list = (process.env.YANDEX_AI_MODELS ?? "").split(",").map(m => m.trim()).filter(Boolean);
  return (list.length ? list : DEFAULT_AI_MODELS).map(m => (m.startsWith("gpt://") ? m : `gpt://${folder}/${m}`));
}

/** Убираем блок рассуждений, который некоторые открытые модели (Qwen3, DeepSeek-R1) пишут перед ответом. */
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

/**
 * Ответ первой ответившей модели или null. Инструкция — системным сообщением,
 * пользовательские данные — отдельным, чтобы они не выдавали себя за указания.
 */
export async function aiText(instruction: string, input: string, options: AiOptions = {}): Promise<string | null> {
  const apiKey = process.env.YANDEX_API_KEY;
  const folder = process.env.YANDEX_FOLDER_ID;
  if (!apiKey || !folder) return null;

  const system = options.json
    ? `${instruction}\n\nОтвет — только один JSON-объект, без markdown, пояснений и текста вокруг.`
    : instruction;

  for (const model of models(folder)) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Api-Key ${apiKey}`,
          "OpenAI-Project": folder,
          "x-folder-id": folder,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: input },
          ],
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxOutputTokens ?? 600,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? MODEL_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error("AI error", model, response.status, (await response.text()).slice(0, 300));
        // Ошибка в самом запросе (400, 401, 403) — другие модели не помогут
        if (![404, 429].includes(response.status) && response.status < 500) return null;
        continue;
      }
      const data = await response.json();
      const text: unknown = data.choices?.[0]?.message?.content;
      if (typeof text === "string" && stripThinking(text)) return stripThinking(text);
    } catch (error) {
      console.error("AI request failed", model, error); // таймаут или сеть — пробуем следующую
    }
  }
  return null;
}
