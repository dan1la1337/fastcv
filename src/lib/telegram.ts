// Только для серверного кода (route handlers): здесь работа с токеном бота.
import { createHash } from "node:crypto";

/**
 * Бот подборок для кандидатов (не путать с ботом оповещений владельца в сборщике).
 * Токен — только в переменной окружения TELEGRAM_JOBS_BOT_TOKEN на сервере.
 */
export function jobsBotToken(): string | null {
  const token = process.env.TELEGRAM_JOBS_BOT_TOKEN?.trim();
  return token && /^\d+:[\w-]{30,}$/.test(token) ? token : null;
}

/**
 * Секрет, который Telegram присылает в заголовке X-Telegram-Bot-Api-Secret-Token.
 * Выводится из токена, чтобы не заводить ещё одну переменную; сам токен по нему не восстановить.
 */
export function webhookSecret(token: string): string {
  return createHash("sha256").update(`fastcv-webhook:${token}`).digest("hex");
}

export class TelegramApiError extends Error {
  constructor(public code: number, description: string) {
    super(`${code} ${description}`);
  }
}

export async function telegram<T = unknown>(token: string, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error_code?: number; description?: string };
  if (!body.ok) throw new TelegramApiError(body.error_code ?? response.status, String(body.description ?? "").slice(0, 200));
  return body.result as T;
}
