import Link from "next/link";

export const metadata = { title: "Страница не найдена — FastCV" };

export default function NotFound() {
  return (
    <main className="min-h-screen text-neutral-100 flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <p className="text-6xl font-black text-teal-300">404</p>
        <h1 className="font-display text-xl font-bold">Такой страницы нет</h1>
        <p className="text-sm text-neutral-400">
          Возможно, вакансию уже закрыли или ссылка набрана с ошибкой.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-5 py-2.5 bg-teal-300 hover:bg-teal-200 text-neutral-950 rounded-full text-sm font-semibold transition-colors"
        >
          К вакансиям
        </Link>
      </div>
    </main>
  );
}
