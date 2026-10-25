"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Vacancy } from "@/lib/vacancies";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, X, Sparkles, Loader2, Copy, Check, Mail, ExternalLink, RotateCcw } from "lucide-react";
import { toast } from "@/components/Toaster";

// Настройки письма (значения совпадают с /api/cover-letter)
const LETTER_OPTIONS = {
  tone: [["neutral", "Деловой"], ["formal", "Официальный"], ["friendly", "Неформальный"]],
  length: [["short", "Коротко"], ["medium", "Обычно"], ["long", "Подробно"]],
  language: [["auto", "Как в вакансии"], ["ru", "Русский"], ["en", "English"]],
} as const;
type LetterSettings = { tone: string; length: string; language: string };
const LETTER_LABELS = { tone: "Тон", length: "Длина", language: "Язык" } as const;

/** Username Telegram из контакта вакансии; null, если это не похоже на username. */
function telegramUsername(value: string): string | null {
  const name = value.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
  return /^[A-Za-z0-9_]{4,32}$/.test(name) ? name : null;
}

/**
 * Окно Smart Apply: генерация сопроводительного письма, сохранение отклика и
 * переход к контакту работодателя. Открыто, пока передан vacancy.
 */
export default function SmartApply({
  vacancy,
  user,
  onClose,
  inline = false,
}: {
  vacancy: Vacancy | null;
  user: User | null;
  onClose: () => void;
  /** Панель на странице вакансии вместо модального окна. */
  inline?: boolean;
}) {
  // Состояния модального окна Smart Apply
  // Письмо и ошибка привязаны к id вакансии: у другой вакансии окно чистое
  const [draft, setDraft] = useState<{ vacancyId: string; text: string; error: string | null } | null>(null);
  // Откуда письмо: ИИ, сохранённое ранее или шаблон (ИИ не ответил). После «Переписать»
  // для этой вакансии просим новое письмо, а не сохранённое.
  const [letterSource, setLetterSource] = useState<{ vacancyId: string; source: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<LetterSettings>({ tone: "neutral", length: "medium", language: "auto" });
  const [isSending, setIsSending] = useState(false);
  const router = useRouter();
  const current = draft && vacancy && draft.vacancyId === vacancy.id ? draft : null;
  const coverLetter = current?.text ?? "";
  const generationError = current?.error ?? null;
  const setCoverLetter = (text: string) => vacancy && setDraft({ vacancyId: vacancy.id, text, error: null });
  const setGenerationError = (error: string | null) =>
    vacancy && setDraft({ vacancyId: vacancy.id, text: coverLetter, error });

  // Состояние окна подтверждения для Email / Внешних контактов
  const [successContactModal, setSuccessContactModal] = useState<{
    open: boolean;
    type: string;
    value: string;
    vacancyTitle: string;
  }>({ open: false, type: "", value: "", vacancyTitle: "" });
  
  const [copiedEmail, setCopiedEmail] = useState(false);

  // --- ЛОГИКА SMART APPLY ---
  const generateCoverLetter = async () => {
    if (!vacancy) return;
    setIsGenerating(true);
    setGenerationError(null);

    try {
      // Сессия уходит в cookies сама: токен вручную передавать не нужно
      const regenerate = letterSource?.vacancyId === vacancy.id;
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vacancyId: vacancy.id, regenerate, ...settings }),
      });
      const data = await res.json();
      if (res.ok && data.text) {
        setCoverLetter(data.text);
        setLetterSource({ vacancyId: vacancy.id, source: data.source ?? "ai" });
      } else {
        setGenerationError(data.error || "Не удалось сгенерировать письмо. Попробуйте ещё раз.");
      }
    } catch {
      setGenerationError("Не удалось связаться с сервером. Попробуйте ещё раз.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const sendApplication = async () => {
    if (!vacancy) return;
    if (!user) {
      toast("Сначала войдите в систему.", "error");
      return;
    }
    setIsSending(true);
    const { error } = await supabase.from("applications").insert({
      vacancy_id: vacancy.id,
      candidate_id: user.id,
      cover_letter: coverLetter,
      status: 'new'
    });
    setIsSending(false);

    if (error) {
      toast(error.code === "23505"
        ? "Вы уже откликались на эту вакансию."
        : error.message.includes("apply_limit")
          ? "Сегодня уже 15 откликов — это лимит FastCV против рассылок. Письмо сохранено в буфере, отправить можно завтра."
          : "Не удалось отправить отклик: " + error.message, "error");
      if (error.message.includes("apply_limit")) navigator.clipboard.writeText(coverLetter).catch(() => {});
      return;
    }

    // Копируем сопроводительное письмо кандидату в буфер обмена для удобства
    navigator.clipboard.writeText(coverLetter).catch(() => {});

    onClose();

    // Разделяем поведение контактов
    const tg = vacancy.contact_type !== 'email' && vacancy.contact_value
      ? telegramUsername(vacancy.contact_value) : null;
    if (vacancy.source_type === 'external' && vacancy.contact_type === 'email' && vacancy.contact_value) {
      // Показываем модальное окно для отправки на Email без навязчивого Outlook
      setSuccessContactModal({
        open: true,
        type: 'email',
        value: vacancy.contact_value.trim(),
        vacancyTitle: vacancy.title
      });
    } else if (vacancy.source_type === 'external' && tg) {
      window.open(`https://t.me/${tg}`, '_blank', 'noopener');
      toast("Письмо скопировано. Вставьте его в чат с работодателем в Telegram.", "ok");
    } else if (vacancy.source_type === 'external') {
      // Контакта в посте нет — открываем оригинал, там есть ссылка на отклик
      if (vacancy.source_url) window.open(vacancy.source_url, '_blank', 'noopener');
      toast("Письмо скопировано. Контакта в посте нет — откликнитесь по ссылке из оригинального поста.", "info");
    } else {
      // Внутренняя вакансия — отклик уже у работодателя в кабинете
      toast("Отклик доставлен работодателю.", "ok");
      router.push('/applications');
    }
  };

  // Тело Smart Apply: настройки и генерация, затем письмо и отправка. Одно и то же
  // в окне (лента) и в панели справа на странице вакансии.
  const panel = vacancy && (
    <div className="space-y-4">
      {!coverLetter ? (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400 leading-relaxed">
            ИИ прочитает вакансию и ваш профиль и напишет сопроводительное письмо под эту позицию — с навыками, которые совпадают.
          </p>
          {user && (Object.keys(LETTER_OPTIONS) as (keyof typeof LETTER_OPTIONS)[]).map(key => (
            <div key={key} className="space-y-1.5">
              <p className="text-xs text-neutral-500">{LETTER_LABELS[key]}</p>
              <div role="group" aria-label={LETTER_LABELS[key]} className="grid grid-cols-3 gap-1 p-1 rounded-full bg-white/[0.06]">
                {LETTER_OPTIONS[key].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={settings[key] === value}
                    onClick={() => setSettings(prev => ({ ...prev, [key]: value }))}
                    className={`text-xs sm:text-sm px-2 py-2 rounded-full transition-colors ${settings[key] === value
                      ? "bg-white/[0.14] text-white"
                      : "text-neutral-400 hover:text-neutral-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {user ? (
            <button
              onClick={generateCoverLetter}
              disabled={isGenerating}
              className="w-full inline-flex items-center justify-center gap-2 bg-teal-300 hover:bg-teal-200 text-neutral-950 h-12 rounded-full text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Пишем письмо…</> : <><Sparkles className="w-4 h-4" /> Написать письмо</>}
            </button>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/vacancy/${vacancy.id}`)}`}
              className="w-full inline-flex items-center justify-center gap-2 bg-teal-300 hover:bg-teal-200 text-neutral-950 h-12 rounded-full text-sm font-semibold transition-colors"
            >
              Войдите, чтобы откликнуться
            </Link>
          )}
          {generationError && (
            <p className="text-sm text-red-400">{generationError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <label htmlFor={`letter-${vacancy.id}`} className="text-xs text-neutral-500">Сопроводительное письмо</label>
          <textarea
            id={`letter-${vacancy.id}`}
            value={coverLetter}
            onChange={(e) => setCoverLetter(e.target.value)}
            className="letter-write w-full h-64 bg-[#0B0F19] border border-white/10 rounded-2xl p-4 text-sm text-neutral-200 focus:outline-none focus:border-teal-300 leading-relaxed resize-none"
          />
          {letterSource?.vacancyId === vacancy.id && letterSource.source === "template" ? (
            <p className="text-xs text-amber-400">
              ИИ сейчас не отвечает, поэтому письмо собрано по шаблону из вашего профиля. Отредактируйте его или нажмите «Переписать» чуть позже.
            </p>
          ) : letterSource?.vacancyId === vacancy.id && letterSource.source === "cache" ? (
            <p className="text-xs text-neutral-500">Это письмо вы уже генерировали для этой вакансии. «Переписать» — новый вариант.</p>
          ) : (
            <p className="text-xs text-neutral-500">Текст можно поправить перед отправкой.</p>
          )}
          <div className="flex gap-2.5">
            <button
              onClick={sendApplication}
              disabled={isSending}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-teal-300 hover:bg-teal-200 text-neutral-950 h-12 rounded-full text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Откликнуться с письмом
            </button>
            <button
              onClick={() => setCoverLetter("")}
              aria-label="Переписать письмо"
              title="Переписать"
              className="w-12 h-12 shrink-0 inline-flex items-center justify-center rounded-full border border-white/15 text-neutral-300 hover:text-white hover:border-white/30 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const title = (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="ai-shimmer w-7 h-7 rounded-[9px] shrink-0" />
      <h2 className="font-display text-lg font-bold text-white">Smart Apply</h2>
    </div>
  );

  return (
    <>
      {inline && vacancy && (
        <aside aria-label="Smart Apply" className="glass rounded-3xl p-6 space-y-5">
          {title}
          {panel}
        </aside>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО SMART APPLY --- */}
      {!inline && vacancy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div role="dialog" aria-modal="true" aria-label={`Smart Apply: ${vacancy.title}`}
            className="bg-[#0B0F19]/95 border border-white/12 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-white/10">
              <div className="space-y-1.5 min-w-0">
                {title}
                <p className="text-sm text-neutral-400 truncate">{vacancy.title}</p>
              </div>
              <button onClick={() => onClose()} aria-label="Закрыть" className="text-neutral-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">{panel}</div>
          </div>
        </div>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО ДЛЯ EMAIL-ВАКАНСИЙ (БЕЗ ПРИНУДИТЕЛЬНОГО OUTLOOK) --- */}
      {successContactModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-6 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Check className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-white text-base">Отклик сформирован</h3>
              </div>
              <button onClick={() => setSuccessContactModal({ ...successContactModal, open: false })} className="text-neutral-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-neutral-400">
                Текст сопроводительного письма <span className="text-emerald-400 font-semibold">уже скопирован в буфер обмена</span>. Отправьте резюме на почту работодателя:
              </p>

              {/* Поле с адресом почты и кнопкой копирования */}
              <div className="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-xl p-3.5">
                <div className="flex items-center gap-3 overflow-hidden">
                  <Mail className="w-4 h-4 text-teal-300 shrink-0" />
                  <span className="text-sm font-mono text-neutral-200 truncate">{successContactModal.value}</span>
                </div>
                <button
                  onClick={() => handleCopy(successContactModal.value)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium transition-colors shrink-0 ml-2"
                >
                  {copiedEmail ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedEmail ? "Скопировано" : "Скопировать"}
                </button>
              </div>

              {/* Кнопки выбора способа отправки */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(successContactModal.value)}&su=${encodeURIComponent("Отклик на вакансию: " + successContactModal.vacancyTitle)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl text-xs font-semibold text-neutral-200 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-red-400" /> Открыть в Gmail
                </a>

                <a
                  href={`mailto:${encodeURIComponent(successContactModal.value)}?subject=${encodeURIComponent("Отклик на вакансию: " + successContactModal.vacancyTitle)}`}
                  className="flex items-center justify-center gap-2 py-2.5 px-4 bg-teal-300 hover:bg-teal-200 rounded-xl text-xs font-semibold text-neutral-950 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" /> Написать на почту
                </a>
              </div>
            </div>

            <button
              onClick={() => setSuccessContactModal({ ...successContactModal, open: false })}
              className="w-full py-2.5 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 text-xs font-medium rounded-xl transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </>
  );
}
