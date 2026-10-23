// Скелет страницы вакансии, пока сервер получает её из базы
export default function Loading() {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8" aria-busy="true" aria-label="Загрузка вакансии">
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-4 w-24 rounded bg-neutral-800" />
        <div className="space-y-3">
          <div className="h-5 w-28 rounded-full bg-neutral-800" />
          <div className="h-8 w-3/4 rounded bg-neutral-800" />
          <div className="h-5 w-40 rounded bg-neutral-800" />
          <div className="h-6 w-48 rounded bg-neutral-800" />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-4 rounded bg-neutral-900" />)}
          <div className="h-4 w-2/3 rounded bg-neutral-900" />
        </div>
      </div>
    </main>
  );
}
