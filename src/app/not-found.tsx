import Link from "next/link";

export const metadata = { title: "Страница не найдена — FastCV" };

export default function NotFound() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <p className="text-6xl font-black text-blue-500">404</p>
        <h1 className="text-xl font-semibold">Такой страницы нет</h1>
        <p className="text-sm text-neutral-400">
          Возможно, вакансию уже закрыли или ссылка набрана с ошибкой.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          К вакансиям
        </Link>
      </div>
    </main>
  );
}
