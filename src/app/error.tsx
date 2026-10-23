"use client"; // Границы ошибок в Next.js — клиентские компоненты

import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">Что-то пошло не так</h1>
        <p className="text-sm text-neutral-400">
          Мы уже видим ошибку в логах. Попробуйте ещё раз — обычно это помогает.
        </p>
        {error.digest && <p className="text-xs text-neutral-600 font-mono">Код: {error.digest}</p>}
        <div className="flex justify-center gap-3">
          <button
            onClick={() => retry()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Повторить
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-sm text-neutral-200 transition-colors"
          >
            На главную
          </Link>
        </div>
      </div>
    </main>
  );
}
