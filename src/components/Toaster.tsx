"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastKind = "ok" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const EVENT = "fastcv:toast";
let nextId = 1;

/** Показать всплывающее уведомление. Работает из любого клиентского кода, вместо alert(). */
export function toast(text: string, kind: ToastKind = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastItem>(EVENT, { detail: { id: nextId++, kind, text } }));
}

const STYLES: Record<ToastKind, { box: string; icon: typeof Info }> = {
  ok: { box: "border-emerald-500/30 bg-emerald-950/90 text-emerald-100", icon: CheckCircle2 },
  error: { box: "border-red-500/30 bg-red-950/90 text-red-100", icon: XCircle },
  info: { box: "border-neutral-700 bg-neutral-900/95 text-neutral-100", icon: Info },
};

/** Вывод уведомлений. Подключён один раз в корневом layout. */
export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems(prev => [...prev.slice(-3), item]);
      // Ошибки висят дольше: их важнее успеть прочитать
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== item.id)), item.kind === "error" ? 8000 : 5000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      aria-live="polite"
      className="fixed z-[100] bottom-4 left-4 right-4 sm:left-auto sm:w-96 flex flex-col gap-2 pointer-events-none"
    >
      {items.map(item => {
        const { box, icon: Icon } = STYLES[item.kind];
        return (
          <div
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-2 ${box}`}
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="flex-1 leading-snug">{item.text}</p>
            <button
              onClick={() => setItems(prev => prev.filter(t => t.id !== item.id))}
              className="opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Закрыть уведомление"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
