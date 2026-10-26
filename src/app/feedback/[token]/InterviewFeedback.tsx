"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import Logo from "@/components/Logo";
import InterviewStars from "@/components/InterviewStars";
import { supabase } from "@/lib/supabase";
import { isNetworkError } from "@/lib/auth-errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Оценка сохраняется из браузера, а не при загрузке страницы на сервере:
 * так её не поставят роботы, которые открывают ссылки для предпросмотра.
 */
export default function InterviewFeedback({ token, initial }: { token: string; initial: number | null }) {
  const [rating, setRating] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "invalid" | "error">(UUID.test(token) ? "idle" : "invalid");
  const sent = useRef(false);

  async function rate(value: number) {
    setRating(value);
    setState("saving");
    const { data, error } = await supabase.rpc("rate_interview", { token, rating: value });
    if (error) return setState(isNetworkError(error.message) ? "error" : "invalid");
    setState(data ? "saved" : "invalid");
  }

  useEffect(() => {
    if (initial && UUID.test(token) && !sent.current) {
      sent.current = true;
      void rate(initial);
    }
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full glass rounded-3xl p-8 text-center space-y-5">
        <Logo />
        <h1 className="font-display text-2xl font-bold text-white">Как прошло собеседование?</h1>
        {state === "invalid" ? (
          <p className="text-sm text-neutral-400">
            Ссылка устарела или опрос уже закрыт. Оценить собеседование можно в разделе{" "}
            <Link href="/applications" className="text-teal-300 hover:underline">«Мои отклики»</Link>.
          </p>
        ) : (
          <>
            <InterviewStars value={rating} onRate={rate} disabled={state === "saving"} />
            <p aria-live="polite" className="text-sm min-h-5">
              {state === "saved" && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Спасибо! Оценка учтена — её можно поменять.
                </span>
              )}
              {state === "error" && <span className="text-amber-300">Нет связи с сервером. Нажмите на оценку ещё раз.</span>}
              {state === "idle" && <span className="text-neutral-400">Оценка анонимна: работодатель видит только среднюю.</span>}
            </p>
          </>
        )}
        <Link href="/" className="inline-block text-sm text-neutral-400 hover:text-white">К вакансиям</Link>
      </div>
    </div>
  );
}
