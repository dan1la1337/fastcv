// Поддельный клиент Supabase для юнит-тестов API-маршрутов: любой запрос к таблице
// возвращает заданную строку, rpc — заданный ответ. Цепочки (select/eq/insert…) принимаются как есть.

type Result = { data: unknown; error: { message: string } | null };

export interface FakeSupabaseOptions {
  user?: { id: string } | null;
  tables?: Record<string, unknown>;
  rpc?: Record<string, Result | unknown>;
}

const isResult = (v: unknown): v is Result => Boolean(v) && typeof v === "object" && "data" in (v as object) && "error" in (v as object);

export function fakeSupabase({ user = { id: "user-1" }, tables = {}, rpc = {} }: FakeSupabaseOptions = {}) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const from = (table: string) => {
    const result = (): Result => ({ data: tables[table] ?? null, error: null });
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "delete", "update", "insert", "upsert"]) {
      query[method] = () => query;
    }
    query.maybeSingle = async () => result();
    query.single = async () => result();
    query.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return query;
  };
  return {
    rpcCalls,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from,
    // Как в supabase-js: ответ можно ждать сразу или через .maybeSingle()/.single()
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      const value = rpc[name];
      const result = Promise.resolve<Result>(isResult(value) ? value : { data: value ?? null, error: null });
      return Object.assign(result, { maybeSingle: () => result, single: () => result });
    },
  };
}

/** Ответ Gemini generateContent с текстом. */
export const geminiResponse = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
