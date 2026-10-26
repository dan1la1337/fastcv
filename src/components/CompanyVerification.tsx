"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isNetworkError } from "@/lib/auth-errors";

const inputClass =
  "flex-1 min-w-0 bg-[#0B0F19] border border-white/12 rounded-2xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-teal-300 transition-colors";

/** Текст ошибки из базы («company_domain: …») — без служебного префикса. */
function errorText(message: string): string {
  if (isNetworkError(message)) return "Нет связи с сервером. Попробуйте ещё раз.";
  const m = message.match(/company_domain: (.+)/);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + "." : "Не получилось. Попробуйте ещё раз.";
}

/**
 * Подтверждение компании для работодателя: домен → TXT-запись «fastcv-verify=…» → проверка.
 * Подтверждённым — значок «Проверенный работодатель» на всех их вакансиях.
 */
export default function CompanyVerification({ userId }: { userId: string }) {
  const [state, setState] = useState<{ domain: string | null; token: string | null; verifiedAt: string | null } | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.from("profiles").select("company_domain, company_verify_token, company_verified_at").eq("id", userId).maybeSingle()
      .then(({ data }) => {
        setState({ domain: data?.company_domain ?? null, token: data?.company_verify_token ?? null, verifiedAt: data?.company_verified_at ?? null });
        setDomain(data?.company_domain ?? "");
      });
  }, [userId]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("start_company_verification", { domain });
    setBusy(false);
    if (error) return setMessage({ ok: false, text: errorText(error.message) });
    const clean = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
    setState({ domain: clean, token: data, verifiedAt: null });
  }

  async function check() {
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("check_company_verification");
    setBusy(false);
    if (error) return setMessage({ ok: false, text: errorText(error.message) });
    if (data) {
      setState(s => s && { ...s, verifiedAt: new Date().toISOString() });
      setMessage({ ok: true, text: "Компания подтверждена: на ваших вакансиях появился значок «Проверенный работодатель»." });
    } else {
      setMessage({ ok: false, text: "Запись пока не видна. Обновление DNS занимает от нескольких минут до пары часов — проверьте позже." });
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  if (!state) return null;
  const record = state.token ? `fastcv-verify=${state.token}` : null;

  return (
    <section aria-labelledby="company-verify" className="glass rounded-3xl p-6 sm:p-8 space-y-4">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className={`w-5 h-5 ${state.verifiedAt ? "text-teal-300" : "text-neutral-400"}`} aria-hidden="true" />
        <h2 id="company-verify" className="text-lg font-bold text-white">Подтверждение компании</h2>
      </div>

      {state.verifiedAt ? (
        <p className="text-sm text-neutral-300">
          Домен <span className="font-semibold text-white">{state.domain}</span> подтверждён. На ваших вакансиях — значок
          <span className="text-teal-300"> «Проверенный работодатель»</span>: кандидаты охотнее откликаются проверенным компаниям.
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Докажите, что вы представляете компанию: добавьте запись в DNS её домена. Подтверждённым работодателям мы показываем
            значок «Проверенный работодатель».
          </p>
          <form onSubmit={start} className="flex flex-wrap gap-2">
            <label htmlFor="company-domain" className="sr-only">Домен компании</label>
            <input id="company-domain" value={domain} onChange={e => setDomain(e.target.value)} placeholder="acme.ru"
              className={inputClass} />
            <button type="submit" disabled={busy || !domain.trim()}
              className="px-5 py-3 rounded-full border border-white/15 text-sm text-neutral-200 hover:border-white/30 disabled:opacity-50 transition-colors">
              {record ? "Сменить домен" : "Получить код"}
            </button>
          </form>

          {record && (
            <div className="space-y-3">
              <ol className="text-sm text-neutral-400 space-y-1.5 list-decimal pl-5">
                <li>Откройте настройки DNS домена <span className="text-neutral-200">{state.domain}</span> у регистратора или хостинга.</li>
                <li>Добавьте запись типа <span className="text-neutral-200">TXT</span> для самого домена (имя «@») с таким значением:</li>
              </ol>
              <div className="flex items-center gap-2 bg-[#0B0F19] border border-white/12 rounded-2xl p-3">
                <code className="flex-1 min-w-0 truncate font-mono text-xs text-teal-200">{record}</code>
                <button type="button" onClick={() => copy(record)} aria-label="Скопировать запись"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-xs text-neutral-200">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Скопировано" : "Копировать"}
                </button>
              </div>
              <button type="button" onClick={check} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-teal-300 hover:bg-teal-200 text-neutral-950 h-12 rounded-full text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Проверить запись
              </button>
            </div>
          )}
        </>
      )}

      {message && <p aria-live="polite" className={`text-sm ${message.ok ? "text-emerald-400" : "text-amber-300"}`}>{message.text}</p>}
    </section>
  );
}
