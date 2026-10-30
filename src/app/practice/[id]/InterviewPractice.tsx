"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Lightbulb, Loader2, Mic, MicOff, RotateCcw, Sparkles, Trophy } from "lucide-react";
import {
  ANSWER_MAX, KIND_LABEL, QUESTION_COUNT, summary, type PracticeGrade, type PracticeQuestion,
} from "@/lib/practice";

type Step = { answer: string; grade: PracticeGrade | null };

// Распознавание речи браузера (Chrome, Edge, Safari) — без отправки звука нам
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const scoreColor = (s: number) => (s >= 8 ? "text-emerald-300" : s >= 5 ? "text-amber-300" : "text-red-300");

async function call(body: object): Promise<{ data?: Record<string, unknown>; error?: string }> {
  try {
    const res = await fetch("/api/interview-practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { data } : { error: data.error ?? "Не получилось. Попробуйте ещё раз." };
  } catch {
    return { error: "Нет связи с сервером. Попробуйте ещё раз." };
  }
}

export default function InterviewPractice({ vacancyId, title }: { vacancyId: string; title: string }) {
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setCanSpeak(!!speechRecognition()), 0);
    return () => { window.clearTimeout(id); recognition.current?.stop(); };
  }, []);

  async function start() {
    setLoading(true);
    setError(null);
    const { data, error } = await call({ action: "questions", vacancyId });
    setLoading(false);
    if (error) return setError(error);
    const list = (data?.questions ?? []) as PracticeQuestion[];
    setQuestions(list);
    setSteps(list.map(() => ({ answer: "", grade: null })));
    setCurrent(0);
    setShowHint(false);
  }

  const step = steps[current];
  const question = questions?.[current];
  const finished = !!questions && current >= questions.length;

  function setAnswer(answer: string) {
    setSteps(all => all.map((s, i) => (i === current ? { ...s, answer: answer.slice(0, ANSWER_MAX) } : s)));
  }

  function toggleVoice() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = false;
    const base = step?.answer ?? "";
    let heard = "";
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += (heard ? " " : "") + e.results[i][0].transcript.trim();
      }
      setAnswer((base ? base + " " : "") + heard);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  }

  async function grade() {
    if (!question || !step?.answer.trim()) return;
    recognition.current?.stop();
    setGrading(true);
    setError(null);
    const { data, error } = await call({ action: "grade", vacancyId, question: question.q, answer: step.answer });
    setGrading(false);
    if (error) return setError(error);
    setSteps(all => all.map((s, i) => (i === current ? { ...s, grade: data?.grade as PracticeGrade } : s)));
  }

  function next() {
    recognition.current?.stop();
    setShowHint(false);
    setError(null);
    setCurrent(c => c + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!questions) {
    return (
      <section className="glass rounded-3xl p-6 sm:p-8 space-y-5">
        <p className="text-neutral-200 leading-relaxed">
          {QUESTION_COUNT} вопросов, как на настоящем собеседовании на эту позицию: технические по стеку вакансии, про ваш опыт
          и вопросы самого работодателя, если он их задал. Отвечайте письменно или голосом — ИИ оценит ответ
          по 10-балльной шкале, покажет, что получилось, что добавить, и как мог бы звучать сильный ответ.
        </p>
        <p className="text-xs text-neutral-500">Ответы никуда не сохраняются и работодателю не видны.</p>
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
        <button onClick={start} disabled={loading}
          className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 font-semibold disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? "Готовлю вопросы…" : "Начать тренировку"}
        </button>
      </section>
    );
  }

  if (finished) {
    const total = summary(steps.map(s => s.grade));
    return (
      <section className="glass rounded-3xl p-6 sm:p-8 space-y-6" aria-label="Итоги тренировки">
        <div className="flex flex-wrap items-center gap-4">
          <Trophy className="w-10 h-10 text-amber-300" aria-hidden="true" />
          <div>
            <h2 className="font-display text-xl font-bold">Тренировка завершена</h2>
            <p className="text-neutral-300">
              {total ? <>Средний балл: <b className={scoreColor(total.average)}>{total.average.toLocaleString("ru-RU")} из 10</b> · отвечено {total.answered} из {questions.length}</>
                : "Вы пропустили все вопросы — попробуйте ответить хотя бы на пару."}
            </p>
          </div>
        </div>
        <ol className="space-y-2">
          {questions.map((q, i) => (
            <li key={i} className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3 text-sm">
              <span className="text-neutral-200">{i + 1}. {q.q}</span>
              <span className={`shrink-0 font-semibold ${steps[i].grade ? scoreColor(steps[i].grade!.score) : "text-neutral-500"}`}>
                {steps[i].grade ? `${steps[i].grade!.score}/10` : "пропущен"}
              </span>
            </li>
          ))}
        </ol>
        {total && total.average < 7 && (
          <p className="text-sm text-neutral-300">Совет: вернитесь к вопросам с низким баллом и перечитайте «Как мог бы звучать сильный ответ» — затем пройдите тренировку ещё раз.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <button onClick={start} disabled={loading}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-white/15 text-sm hover:border-white/30 disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Новые вопросы
          </button>
          <Link href={`/vacancy/${vacancyId}#smart-apply`}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold">
            К вакансии «{title.length > 40 ? title.slice(0, 40) + "…" : title}»
          </Link>
        </div>
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      </section>
    );
  }

  const g = step.grade;
  return (
    <section className="glass rounded-3xl p-6 sm:p-8 space-y-5" aria-label={`Вопрос ${current + 1} из ${questions.length}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-teal-300 transition-all" style={{ width: `${(current / questions.length) * 100}%` }} />
        </div>
        <span className="text-xs text-neutral-400 whitespace-nowrap">Вопрос {current + 1} из {questions.length}</span>
      </div>

      <div className="space-y-2">
        <span className="inline-block px-2.5 py-0.5 rounded-full bg-white/[0.08] text-[11px] text-neutral-300">{KIND_LABEL[question!.kind]}</span>
        <h2 className="text-lg sm:text-xl font-semibold text-white leading-snug">{question!.q}</h2>
        {question!.hint && (showHint
          ? <p className="text-sm text-amber-100/90 inline-flex gap-1.5"><Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />{question!.hint}</p>
          : <button onClick={() => setShowHint(true)} className="text-xs text-neutral-400 hover:text-white inline-flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> Подсказка</button>)}
      </div>

      <div className="space-y-2">
        <label htmlFor="practice-answer" className="sr-only">Ваш ответ</label>
        <textarea id="practice-answer" ref={area} rows={7} value={step.answer} maxLength={ANSWER_MAX}
          onChange={e => setAnswer(e.target.value)} disabled={grading}
          placeholder={canSpeak ? "Напишите ответ или нажмите на микрофон и отвечайте вслух…" : "Напишите ответ так, как сказали бы на собеседовании…"}
          className="w-full bg-[#0B0F19] border border-white/12 rounded-2xl px-4 py-3 text-sm text-neutral-100 focus:outline-none focus:border-teal-300 resize-y leading-relaxed" />
        <div className="flex flex-wrap items-center gap-2">
          {canSpeak && (
            <button type="button" onClick={toggleVoice} disabled={grading} aria-pressed={listening}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-full border text-sm transition-colors ${
                listening ? "border-red-400/60 text-red-300 bg-red-400/10" : "border-white/15 text-neutral-200 hover:border-white/30"}`}>
              {listening ? <><MicOff className="w-4 h-4" /> Остановить запись</> : <><Mic className="w-4 h-4" /> Ответить голосом</>}
            </button>
          )}
          <span className="flex-1" />
          {!g && <button type="button" onClick={next} className="h-10 px-3 text-sm text-neutral-400 hover:text-white">Пропустить</button>}
          <button type="button" onClick={grade} disabled={grading || step.answer.trim().length < 3}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50">
            {grading && <Loader2 className="w-4 h-4 animate-spin" />} {g ? "Проверить снова" : "Проверить ответ"}
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      </div>

      {g && (
        <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-5 space-y-4" aria-live="polite" aria-label="Разбор ответа">
          <div className="flex items-baseline gap-3">
            <span className={`font-display text-3xl font-bold ${scoreColor(g.score)}`}>{g.score}<span className="text-base text-neutral-500">/10</span></span>
            <p className="text-neutral-200">{g.verdict}</p>
          </div>
          {g.good.length > 0 && (
            <div>
              <p className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-1">Получилось</p>
              <ul className="text-sm text-neutral-300 space-y-1 list-disc pl-5">{g.good.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {g.improve.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-1">Что добавить</p>
              <ul className="text-sm text-neutral-300 space-y-1 list-disc pl-5">{g.improve.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {g.better && (
            <details className="text-sm text-neutral-300">
              <summary className="cursor-pointer text-teal-300 hover:text-teal-200">Как мог бы звучать сильный ответ</summary>
              <p className="mt-2 leading-relaxed whitespace-pre-line">{g.better}</p>
            </details>
          )}
          <div className="flex justify-end">
            <button onClick={next} className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-white/[0.1] hover:bg-white/[0.16] text-sm font-semibold">
              {current + 1 < questions.length ? "Следующий вопрос" : "Итоги"} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
