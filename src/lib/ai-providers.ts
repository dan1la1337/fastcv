// Только для серверного кода: HTTP-запросы к конкретным API языковых моделей.
// Перебор моделей, обезличивание и проверка ответа — в src/lib/ai.ts, общие для всех.

import type { AiRequest } from "@/lib/ai";
import { aiFetch } from "@/lib/ai-fetch";

/** Ответ одной модели: текст, либо ошибка — пробовать ли следующую модель. */
export type ModelResult = { ok: true; text: string } | { ok: false; tryNext: boolean };

export interface AiProvider {
  id: string;
  generate(model: string, request: AiRequest): Promise<ModelResult>;
}

/** Перегружена (429, 5xx) или снята с поддержки (404) — поможет другая модель; ошибка в самом запросе (400, 401, 403) — нет. */
const tryNextAfter = (status: number) => status === 404 || status === 429 || status >= 500;

async function post(url: string, headers: Record<string, string>, body: unknown, request: AiRequest, label: string) {
  const response = await aiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) {
    console.error(`${label} error`, response.status, (await response.text()).slice(0, 300));
    return { ok: false as const, tryNext: tryNextAfter(response.status) };
  }
  return { ok: true as const, data: await response.json() };
}

/** Google Gemini (generateContent). Ключ — в заголовке, а не в URL, чтобы не попадал в логи. */
export function geminiProvider(apiKey: string): AiProvider {
  return {
    id: "gemini",
    async generate(model, request) {
      const result = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          // Инструкции — в system_instruction, данные пользователей — отдельным сообщением:
          // так текст вакансии или профиля не может выдать себя за указания модели
          system_instruction: { parts: [{ text: request.instruction }] },
          contents: [{ role: "user", parts: [{ text: request.input }] }],
          generationConfig: {
            temperature: request.temperature,
            ...(request.maxOutputTokens && { maxOutputTokens: request.maxOutputTokens }),
            ...(request.json && { responseMimeType: "application/json" }),
            ...(request.schema && { responseSchema: request.schema }),
          },
        },
        request,
        `Gemini ${model}`,
      );
      if (!result.ok) return result;
      const text: unknown = result.data.candidates?.[0]?.content?.parts?.[0]?.text;
      return typeof text === "string" ? { ok: true, text } : { ok: false, tryNext: true };
    },
  };
}

/** Yandex AI Studio, OpenAI-совместимый API: модели Qwen3, YandexGPT и др. на серверах в России. */
export function yandexProvider(apiKey: string, folder: string): AiProvider {
  return {
    id: "yandex",
    async generate(model, request) {
      // Схему ответа этот API не принимает — описываем её в инструкции, ответ всё равно проверяем сами
      const system = request.json
        ? `${request.instruction}\n\nОтвет — только один JSON-объект, без markdown, пояснений и текста вокруг.` +
          (request.schema ? `\nСхема ответа: ${JSON.stringify(request.schema)}` : "")
        : request.instruction;
      const result = await post(
        "https://llm.api.cloud.yandex.net/v1/chat/completions",
        { Authorization: `Api-Key ${apiKey}`, "OpenAI-Project": folder, "x-folder-id": folder },
        {
          model: model.startsWith("gpt://") ? model : `gpt://${folder}/${model}`,
          messages: [
            { role: "system", content: system },
            { role: "user", content: request.input },
          ],
          temperature: request.temperature,
          ...(request.maxOutputTokens && { max_tokens: request.maxOutputTokens }),
        },
        request,
        `Yandex AI ${model}`,
      );
      if (!result.ok) return result;
      const text: unknown = result.data.choices?.[0]?.message?.content;
      return typeof text === "string" ? { ok: true, text } : { ok: false, tryNext: true };
    },
  };
}
