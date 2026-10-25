"use client";

import { useEffect, useState } from "react";

/**
 * Телефон: кнопка внизу экрана ведёт к панели Smart Apply, пока сама панель не видна.
 * Когда панель на экране, кнопка прячется, чтобы не закрывать её.
 */
export default function MobileApplyBar({ target }: { target: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = document.getElementById(target);
    if (!el || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  if (!visible) return null;
  return (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 px-3 pb-3 pt-2">
      <div className="bg-[#0B0F19]/90 border border-white/12 backdrop-blur-md rounded-3xl p-3 flex items-center gap-3">
        <p className="flex-1 text-xs text-neutral-400 leading-snug">Smart Apply напишет письмо под эту вакансию</p>
        <a href={`#${target}`} className="shrink-0 inline-flex items-center h-12 px-5 rounded-full bg-teal-300 text-neutral-950 text-sm font-semibold">
          Откликнуться
        </a>
      </div>
    </div>
  );
}
