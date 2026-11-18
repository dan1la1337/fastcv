// Только для серверного кода: единый клиент языковой модели для всех ИИ-функций сайта.
//
// Провайдер и порядок моделей — в ai-models.json в корне репозитория (его же читает сборщик
// вакансий). Сменить провайдера — переменная окружения, без правки кода:
//   AI_PROVIDER — gemini (по умолчанию из ai-models.json) или yandex;
//   AI_MODELS   — необязательно: модели через запятую, по порядку перебора;
//   ключи — переменные из api_key_env / folder_env провайдера (GEMINI_API_KEY; YANDEX_API_KEY и YANDEX_FOLDER_ID).
//
// Пользовательские данные уходят в модель только обезличенными: без имени, телефонов, email,
// ссылок, ников, дат рождения и адресов (redactPersonal). Имя человека из профиля передавайте в names.

import aiModels from "../../ai-models.json";
import { geminiProvider, yandexProvider, type AiProvider } from "@/lib/ai-providers";
import { redactPersonal } from "@/lib/redact";

export type { AiProvider, ModelResult } from "@/lib/ai-providers";

type ProviderConfig = { api_key_env: string; folder_env?: string; models: string[] };
type ModelsFile = { provider: string; providers: Record<string, ProviderConfig> };
const MODELS_FILE: ModelsFile = aiModels;

const DEFAULT_TIMEOUT_MS = 20_000;

/** Запрос к одной модели — после обезличивания и подстановки значений по умолчанию. */
export interface AiRequest {
  instruction: string;
  input: string;
  temperature: number;
  maxOutputTokens?: number;
  /** Нужен JSON: ответ без разметки ```json, не разобравшийся — пробуем следующую модель. */
  json?: boolean;
  /** Схема ответа (формат Gemini responseSchema). Провайдер без поддержки схем получает её в инструкции. */
  schema?: object;
  timeoutMs: number;
}

export interface AiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean;
  schema?: object;
  timeoutMs?: number;
  /** Известные имена человека (из профиля, резюме): вырезаются из входа вместе с контактами. */
  names?: (string | null | undefined)[];
}

type Env = Record<string, string | undefined>;

/** Провайдер и модели по ai-models.json и переменным окружения. null — провайдер неизвестен или нет ключа. */
export function aiSettings(env: Env = process.env, file: ModelsFile = MODELS_FILE): { provider: AiProvider; models: string[] } | null {
  const id = (env.AI_PROVIDER || file.provider).trim().toLowerCase();
  const config = file.providers[id];
  if (!config) {
    console.error("Unknown AI_PROVIDER", id);
    return null;
  }
  const apiKey = env[config.api_key_env];
  const folder = config.folder_env ? env[config.folder_env] : undefined;
  if (!apiKey || (config.folder_env && !folder)) return null;
  const override = (env.AI_MODELS ?? "").split(",").map(m => m.trim()).filter(Boolean);
  const models = override.length ? override : config.models;
  const provider = id === "yandex" ? yandexProvider(apiKey, folder!) : id === "gemini" ? geminiProvider(apiKey) : null;
  return provider && models.length ? { provider, models } : null;
}

/** Настроен ли ИИ на сервере (есть ключ выбранного провайдера). */
export const aiConfigured = (env: Env = process.env) => aiSettings(env) !== null;

/** Блок рассуждений, который некоторые открытые модели (Qwen3, DeepSeek-R1) пишут перед ответом, и обёртка ```json. */
const cleanText = (text: string) =>
  text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * Клиент с заданным провайдером и порядком моделей. Ответ первой ответившей модели или null.
 * Перегружена или недоступна — следующая; ошибка в самом запросе — сразу null.
 */
export function createAiClient(provider: AiProvider, models: string[]) {
  return async function text(instruction: string, input: string, options: AiOptions = {}): Promise<string | null> {
    const request: AiRequest = {
      instruction,
      input: redactPersonal(input, options.names),
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxOutputTokens,
      json: options.json || Boolean(options.schema),
      schema: options.schema,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
    for (const model of models) {
      try {
        const result = await provider.generate(model, request);
        if (!result.ok) {
          if (!result.tryNext) return null;
          continue;
        }
        const out = cleanText(result.text);
        if (!out) continue;
        if (request.json && !isJson(out)) {
          console.error("AI returned invalid JSON", provider.id, model, out.slice(0, 200));
          continue;
        }
        return out;
      } catch (error) {
        console.error("AI request failed", provider.id, model, error); // таймаут или сеть — пробуем следующую
      }
    }
    return null;
  };
}

/** Ответ модели по настройкам окружения или null (ИИ не настроен или не ответил). */
export async function aiText(instruction: string, input: string, options: AiOptions = {}): Promise<string | null> {
  const settings = aiSettings();
  if (!settings) return null;
  return createAiClient(settings.provider, settings.models)(instruction, input, options);
}
