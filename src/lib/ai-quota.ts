// Только для серверного кода: лимит запросов к ИИ на пользователя.
// Считает база (функция consume_ai_quota), поэтому счётчик общий для всех серверных
// инстансов и не обходится параллельными запросами. Окно — час.

import { NextResponse } from "next/server";

const WINDOW_SECONDS = 60 * 60;

export interface AiQuota {
  /** Счётчик в базе: cover_letter, screening… */
  kind: string;
  /** Сколько вызовов в час. */
  max: number;
  /** Что считаем, в родительном падеже: «писем», «разборов». */
  label: string;
}

type QuotaResult = { data: unknown; error: { message: string } | null };
/** Достаточно метода rpc клиента Supabase, вызванного от имени пользователя. */
export interface QuotaClient {
  rpc(fn: "consume_ai_quota", args: { quota_kind: string; max_calls: number; window_seconds: number }): PromiseLike<QuotaResult>;
}

/**
 * Списывает один вызов. null — можно звать ИИ; иначе готовый ответ маршрута:
 * 429 с Retry-After, если лимит исчерпан, или 503, если счётчик недоступен —
 * без счётчика не генерируем, иначе лимит ИИ можно выкачать.
 */
export async function consumeAiQuota(supabase: QuotaClient, quota: AiQuota): Promise<NextResponse | null> {
  const { data, error } = await supabase.rpc("consume_ai_quota", {
    quota_kind: quota.kind,
    max_calls: quota.max,
    window_seconds: WINDOW_SECONDS,
  });
  if (error) {
    console.error("AI quota check failed", quota.kind, error.message);
    return NextResponse.json({ error: "Сервис временно недоступен. Попробуйте позже." }, { status: 503 });
  }
  // consume_ai_quota возвращает jsonb: { allowed, retry_after }
  const { allowed, retry_after: retryAfter = WINDOW_SECONDS } = (data ?? {}) as { allowed?: boolean; retry_after?: number };
  if (allowed) return null;
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return NextResponse.json(
    { error: `Лимит: ${quota.max} ${quota.label} в час. Попробуйте через ${minutes} мин.` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
