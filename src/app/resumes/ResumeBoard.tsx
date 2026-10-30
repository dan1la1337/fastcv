"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Bookmark, BookmarkCheck, Briefcase, FileText, Loader2, MapPin, MessageCircle, Search,
  SlidersHorizontal, Users, Wallet, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AREAS, DIRECTIONS, LEVELS, WORK_FORMATS, experienceLabel, formatLabel, levelLabel, plural } from "@/lib/vacancies";
import { chatErrorText } from "@/lib/chat";
import MatchRing from "@/components/MatchRing";
import { toast } from "@/components/Toaster";

type Resume = {
  id: string; name: string | null; headline: string | null; about: string | null; skills: unknown;
  experience_years: number | null; level: string | null; directions: string[] | null; formats: string[] | null;
  city: string | null; salary: number | null; published_at: string | null; has_pdf: boolean; saved: boolean;
  score: number | null; conversation_id: string | null; total: number;
};
type Filters = {
  search: string; dirs: string[]; lvls: string[]; fmts: string[]; city: string; maxSalary: string;
  minExperience: string; withPdf: boolean; onlySaved: boolean; vacancy: string; sort: string;
};

const EMPTY: Filters = {
  search: "", dirs: [], lvls: [], fmts: [], city: "", maxSalary: "", minExperience: "", withPdf: false,
  onlySaved: false, vacancy: "", sort: "fresh",
};
const PAGE = 20;
const EXPERIENCE = [["", "Любой"], ["1", "от 1 года"], ["3", "от 3 лет"], ["5", "от 5 лет"]] as const;
const SORTS = [["fresh", "Сначала свежие"], ["match", "По совпадению с вакансией"], ["experience", "По опыту"], ["salary", "По зарплате ↑"]] as const;
const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? "bg-teal-300 border-teal-300 text-neutral-950" : "border-white/15 text-neutral-300 hover:border-white/30"}`;
const field = "w-full px-4 py-2.5 bg-[#0B0F19] border border-white/12 rounded-2xl text-sm text-neutral-100 focus:outline-none focus:border-teal-300";
const label = "block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2";

const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
const skillsOf = (value: unknown): string[] => Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
const directionLabel = (id: string) => DIRECTIONS.find(d => d.id === id)?.label ?? id;
const freshness = (iso: string | null) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return days <= 0 ? "обновлено сегодня" : days === 1 ? "обновлено вчера" : `обновлено ${days} ${plural(days, ["день", "дня", "дней"])} назад`;
};

export default function ResumeBoard() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [query, setQuery] = useState<Filters>(EMPTY);        // применённые фильтры (поиск — с задержкой)
  const [items, setItems] = useState<Resume[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vacancies, setVacancies] = useState<{ id: string; title: string }[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contact, setContact] = useState<Resume | null>(null);
  const request = useRef(0);

  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  // Текст поиска применяем через паузу в наборе, остальное — сразу
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(filters), filters.search === query.search ? 0 : 400);
    return () => window.clearTimeout(t);
  }, [filters, query.search]);

  // Свои открытые вакансии — для подбора и для предложения кандидату
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("vacancies").select("id, title").eq("employer_id", user.id)
        .is("archived_at", null).order("created_at", { ascending: false }).limit(50);
      setVacancies(data ?? []);
    });
  }, []);

  const load = useCallback(async (f: Filters, offset: number) => {
    const id = ++request.current;
    const { data, error } = await supabase.rpc("resume_board", {
      search: f.search.trim() || null,
      dirs: f.dirs.length ? f.dirs : null,
      lvls: f.lvls.length ? f.lvls : null,
      fmts: f.fmts.length ? f.fmts : null,
      in_city: f.city.trim() || null,
      max_salary: Number(f.maxSalary.replace(/\D/g, "")) || null,
      min_experience: f.minExperience ? Number(f.minExperience) : null,
      with_pdf: f.withPdf,
      only_saved: f.onlySaved,
      for_vacancy: f.vacancy || null,
      sort_by: f.sort === "match" && !f.vacancy ? "fresh" : f.sort,
      page_size: PAGE,
      page_offset: offset,
    });
    if (id !== request.current) return;            // пришёл ответ на устаревший запрос
    if (error) {
      setError("Не удалось загрузить резюме. Обновите страницу.");
      return;
    }
    setError(null);
    const rows = (data ?? []) as Resume[];
    setTotal(rows[0]?.total ?? (offset ? total : 0));
    setItems(prev => offset ? [...(prev ?? []), ...rows] : rows);
  }, [total]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка при смене фильтров
    void load(query, 0);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  async function more() {
    setLoadingMore(true);
    await load(query, items?.length ?? 0);
    setLoadingMore(false);
  }

  async function toggleSaved(r: Resume) {
    setItems(list => list?.map(x => x.id === r.id ? { ...x, saved: !r.saved } : x) ?? null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = r.saved
      ? await supabase.from("resume_marks").delete().eq("employer_id", user.id).eq("candidate_id", r.id)
      : await supabase.from("resume_marks").insert({ employer_id: user.id, candidate_id: r.id });
    if (error) {
      setItems(list => list?.map(x => x.id === r.id ? { ...x, saved: r.saved } : x) ?? null);
      toast("Не получилось сохранить. Попробуйте ещё раз.", "error");
    }
  }

  async function openPdf(r: Resume) {
    const { data } = await supabase.storage.from("resumes").createSignedUrl(`${r.id}/resume.pdf`, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else toast("Резюме недоступно: кандидат мог его удалить или скрыть.", "error");
  }

  const activeCount = [filters.search.trim(), filters.dirs.length, filters.lvls.length, filters.fmts.length, filters.city.trim(),
    filters.maxSalary, filters.minExperience, filters.withPdf].filter(Boolean).length;
  const vacancyTitle = vacancies.find(v => v.id === query.vacancy)?.title;
  const searchWords = query.search.toLowerCase().split(/\s+/).filter(w => w.length > 1);

  return (
    <div className="min-h-screen text-neutral-100 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/employer" aria-label="В кабинет" className="p-2 bg-neutral-900 border border-white/10 rounded-xl hover:bg-white/[0.08] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="font-display text-2xl font-bold">База резюме</h1>
          <span className="text-xs text-neutral-400 bg-neutral-900 px-3 py-1.5 rounded-full border border-white/10">
            {items === null ? "…" : `${total} ${plural(total, ["кандидат", "кандидата", "кандидатов"])}`}
          </span>
          <div role="tablist" aria-label="Какие резюме" className="ml-auto inline-flex gap-1 p-1 rounded-full bg-white/[0.06]">
            {([[false, "Все"], [true, "Сохранённые"]] as const).map(([saved, text]) => (
              <button key={text} role="tab" aria-selected={filters.onlySaved === saved} onClick={() => set({ onlySaved: saved })}
                className={`px-4 py-1.5 rounded-full text-sm ${filters.onlySaved === saved ? "bg-white/[0.14] text-white" : "text-neutral-400 hover:text-white"}`}>
                {text}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-neutral-400 -mt-3">
          Кандидаты, которые сами открыли профиль работодателям. Контакты не показываем — пишите в чат FastCV.
        </p>

        <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
          <button onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}
            className="lg:hidden flex items-center justify-between w-full px-5 py-3 bg-white/[0.04] border border-white/10 rounded-full text-sm font-medium">
            <span className="inline-flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-neutral-400" /> Фильтры
              {activeCount > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-teal-300 text-neutral-950">{activeCount}</span>}
            </span>
          </button>

          <aside aria-label="Фильтры" className={`${filtersOpen ? "" : "hidden"} lg:block glass rounded-3xl p-5 space-y-5 lg:sticky lg:top-6`}>
            <div>
              <label htmlFor="rb-search" className={label}>Поиск</label>
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input id="rb-search" value={filters.search} onChange={e => set({ search: e.target.value })}
                  placeholder="Python, Django, финтех…" className={`${field} pl-10`} />
              </div>
            </div>

            <div>
              <label htmlFor="rb-vacancy" className={label}>Подбор под вакансию</label>
              <select id="rb-vacancy" value={filters.vacancy}
                onChange={e => set({ vacancy: e.target.value, sort: e.target.value ? "match" : filters.sort === "match" ? "fresh" : filters.sort })}
                className={field}>
                <option value="">Без вакансии</option>
                {vacancies.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
              {!vacancies.length && <p className="text-xs text-neutral-500 mt-1.5">Опубликуйте вакансию — покажем процент совпадения.</p>}
            </div>

            <fieldset>
              <legend className={label}>Направление</legend>
              {AREAS.map(area => (
                <details key={area.id} open={area.id === "it"} className="mb-2">
                  <summary className="text-xs text-neutral-400 cursor-pointer select-none mb-2">{area.label}</summary>
                  <div className="flex flex-wrap gap-1.5">
                    {DIRECTIONS.filter(d => d.group === area.id).map(d => (
                      <button key={d.id} type="button" aria-pressed={filters.dirs.includes(d.id)}
                        onClick={() => set({ dirs: toggle(filters.dirs, d.id) })} className={chip(filters.dirs.includes(d.id))}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </fieldset>

            <fieldset>
              <legend className={label}>Уровень</legend>
              <div className="flex flex-wrap gap-1.5">
                {LEVELS.map(l => (
                  <button key={l.id} type="button" aria-pressed={filters.lvls.includes(l.id)}
                    onClick={() => set({ lvls: toggle(filters.lvls, l.id) })} className={chip(filters.lvls.includes(l.id))}>{l.label}</button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="rb-exp" className={label}>Опыт</label>
              <select id="rb-exp" value={filters.minExperience} onChange={e => set({ minExperience: e.target.value })} className={field}>
                {EXPERIENCE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>

            <fieldset>
              <legend className={label}>Формат работы</legend>
              <div className="flex flex-wrap gap-1.5">
                {WORK_FORMATS.map(f => (
                  <button key={f.id} type="button" aria-pressed={filters.fmts.includes(f.id)}
                    onClick={() => set({ fmts: toggle(filters.fmts, f.id) })} className={chip(filters.fmts.includes(f.id))}>{f.label}</button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="rb-city" className={label}>Город</label>
              <input id="rb-city" value={filters.city} onChange={e => set({ city: e.target.value })} placeholder="Москва" className={field} />
              <p className="text-xs text-neutral-500 mt-1.5">Кандидаты на удалёнке показываются для любого города.</p>
            </div>

            <div>
              <label htmlFor="rb-salary" className={label}>Ожидания до, ₽</label>
              <input id="rb-salary" inputMode="numeric" value={filters.maxSalary}
                onChange={e => set({ maxSalary: e.target.value.replace(/\D/g, "").slice(0, 9) })} placeholder="300000" className={field} />
            </div>

            <label className="flex items-center gap-2.5 text-sm text-neutral-300 cursor-pointer">
              <input type="checkbox" checked={filters.withPdf} onChange={e => set({ withPdf: e.target.checked })} className="w-4 h-4 accent-teal-300" />
              Только с PDF-резюме
            </label>

            {activeCount > 0 && (
              <button type="button" onClick={() => setFilters({ ...EMPTY, onlySaved: filters.onlySaved, vacancy: filters.vacancy, sort: filters.sort })}
                className="w-full text-sm text-neutral-400 hover:text-white py-2">Сбросить фильтры</button>
            )}
          </aside>

          <section aria-label="Резюме" className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-neutral-400">
                {vacancyTitle ? <>Совпадение с вакансией «<span className="text-neutral-200">{vacancyTitle}</span>»</> : "Свежие резюме — первыми"}
              </p>
              <label className="text-sm text-neutral-400 inline-flex items-center gap-2">
                <span className="sr-only">Сортировка</span>
                <select value={filters.sort} onChange={e => set({ sort: e.target.value })}
                  className="bg-[#0B0F19] border border-white/12 rounded-full px-3 py-1.5 text-sm text-neutral-200">
                  {SORTS.filter(([v]) => v !== "match" || filters.vacancy).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
            </div>

            {error ? (
              <p className="text-sm text-amber-300 py-10 text-center">{error}</p>
            ) : items === null ? (
              <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-teal-300" /></div>
            ) : items.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-white/15 rounded-3xl space-y-2 px-6">
                <Users className="w-10 h-10 mx-auto text-neutral-600" aria-hidden="true" />
                <p className="text-neutral-300 text-sm font-medium">
                  {filters.onlySaved ? "Вы ещё никого не сохранили" : "Под эти фильтры резюме нет"}
                </p>
                <p className="text-neutral-500 text-sm">
                  {filters.onlySaved ? "Нажмите «Сохранить» у резюме, чтобы вернуться к кандидату позже." : "Ослабьте фильтры или зайдите позже: кандидаты открывают резюме каждый день."}
                </p>
              </div>
            ) : (
              <>
                <ul className="grid gap-4">
                  {items.map(r => {
                    const skills = skillsOf(r.skills);
                    const open = expanded[r.id];
                    const facts = [
                      r.level && levelLabel(r.level), experienceLabel(r.experience_years),
                    ].filter(Boolean).join(" · ");
                    return (
                      <li key={r.id} className="glass rounded-3xl p-5 sm:p-6 space-y-4">
                        <div className="flex flex-wrap items-start gap-4">
                          {r.score !== null && <MatchRing value={r.score} size={64} stroke={r.score >= 70 ? "#5EEAD4" : "#818CF8"} />}
                          <div className="flex-1 min-w-[14rem]">
                            <h2 className="text-lg font-bold text-white">{r.headline || (r.directions?.length ? directionLabel(r.directions[0]) : "Кандидат")}</h2>
                            <p className="text-sm text-neutral-300 mt-0.5">{r.name || "Имя не указано"}</p>
                            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400 mt-2">
                              {facts && <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />{facts}</span>}
                              {(r.city || r.formats?.length) && (
                                <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />
                                  {[r.city, ...(r.formats ?? []).map(f => formatLabel(f))].filter(Boolean).join(" · ")}
                                </span>
                              )}
                              {r.salary && <span className="inline-flex items-center gap-1 text-emerald-300"><Wallet className="w-3.5 h-3.5" />от {r.salary.toLocaleString("ru-RU")} ₽</span>}
                              {freshness(r.published_at) && <span>{freshness(r.published_at)}</span>}
                            </p>
                          </div>
                          <button onClick={() => toggleSaved(r)} aria-pressed={r.saved}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/12 text-xs text-neutral-300 hover:border-white/30">
                            {r.saved ? <><BookmarkCheck className="w-3.5 h-3.5 text-teal-300" /> Сохранён</> : <><Bookmark className="w-3.5 h-3.5" /> Сохранить</>}
                          </button>
                        </div>

                        {skills.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {skills.slice(0, 16).map(s => {
                              const hit = searchWords.some(w => s.toLowerCase().includes(w));
                              return <span key={s} className={`text-xs px-2.5 py-1 rounded-full ${hit ? "bg-teal-300/15 text-teal-200" : "bg-white/[0.06] text-neutral-300"}`}>{s}</span>;
                            })}
                            {skills.length > 16 && <span className="text-xs text-neutral-500 px-1 py-1">+{skills.length - 16}</span>}
                          </div>
                        )}

                        {r.about && (
                          <div>
                            <p className={`text-sm text-neutral-300 leading-relaxed whitespace-pre-line ${open ? "" : "line-clamp-3"}`}>{r.about}</p>
                            {r.about.length > 220 && (
                              <button onClick={() => setExpanded(e => ({ ...e, [r.id]: !open }))} className="text-xs text-teal-300 hover:text-teal-200 mt-1">
                                {open ? "Свернуть" : "Читать полностью"}
                              </button>
                            )}
                          </div>
                        )}

                        {r.directions && r.directions.length > 0 && (
                          <p className="text-xs text-neutral-500">Ищет: {r.directions.map(directionLabel).join(", ")}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-white/10">
                          {r.has_pdf && (
                            <button onClick={() => openPdf(r)}
                              className="mr-auto h-10 px-4 rounded-full border border-white/12 text-neutral-200 hover:border-white/30 text-sm inline-flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5" /> Резюме (PDF)
                            </button>
                          )}
                          {r.conversation_id && (
                            <Link href={`/messages?c=${r.conversation_id}`}
                              className={`${r.has_pdf ? "" : "mr-auto "}h-10 px-4 rounded-full border border-white/12 text-neutral-200 hover:border-white/30 text-sm inline-flex items-center gap-1.5`}>
                              <MessageCircle className="w-3.5 h-3.5" /> Открыть чат
                            </Link>
                          )}
                          <button onClick={() => setContact(r)}
                            className="h-10 px-5 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold inline-flex items-center gap-1.5">
                            <MessageCircle className="w-4 h-4" /> {r.conversation_id ? "Предложить вакансию" : "Написать кандидату"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {items.length < total && (
                  <button onClick={more} disabled={loadingMore}
                    className="w-full h-12 rounded-full border border-white/15 text-sm text-neutral-200 hover:border-white/30 disabled:opacity-50 inline-flex items-center justify-center gap-2">
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />} Показать ещё
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {contact && (
        <ContactDialog resume={contact} vacancies={vacancies} defaultVacancy={query.vacancy}
          onClose={() => setContact(null)}
          onSent={id => { setContact(null); router.push(`/messages?c=${id}`); }} />
      )}
    </div>
  );
}

function ContactDialog({ resume, vacancies, defaultVacancy, onClose, onSent }: {
  resume: Resume;
  vacancies: { id: string; title: string }[];
  defaultVacancy: string;
  onClose: () => void;
  onSent: (conversationId: string) => void;
}) {
  const first = (resume.name || "").trim().split(/\s+/)[0];
  const [vacancy, setVacancy] = useState(defaultVacancy);
  const title = vacancies.find(v => v.id === vacancy)?.title;
  const [text, setText] = useState(
    `Здравствуйте${first ? `, ${first}` : ""}! Нашли ваше резюме на FastCV` +
    (title ? ` — думаем, вам может подойти наша вакансия «${title}».` : ".") +
    " Будет интересно обсудить?");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("start_conversation", { candidate: resume.id, vacancy: vacancy || null, body: text });
    setBusy(false);
    if (error || !data) return setError(chatErrorText(error?.message ?? ""));
    onSent(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="contact-title" onClick={e => e.stopPropagation()}
        className="bg-[#0B0F19]/95 border border-white/12 rounded-3xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="contact-title" className="font-display text-lg font-bold text-white">Написать кандидату</h2>
            <p className="text-sm text-neutral-400 mt-0.5">{resume.headline || resume.name}</p>
          </div>
          <button onClick={onClose} aria-label="Закрыть" className="text-neutral-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div>
          <label htmlFor="contact-vacancy" className={label}>Вакансия</label>
          <select id="contact-vacancy" value={vacancy} onChange={e => setVacancy(e.target.value)} className={field}>
            <option value="">Без вакансии — просто написать</option>
            {vacancies.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
          <p className="text-xs text-neutral-500 mt-1.5">Кандидат увидит карточку вакансии со ссылкой.</p>
        </div>
        <div>
          <label htmlFor="contact-text" className={label}>Сообщение</label>
          <textarea id="contact-text" rows={5} maxLength={4000} value={text} onChange={e => setText(e.target.value)}
            className={`${field} resize-y leading-relaxed`} />
        </div>
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
        <p className="text-xs text-neutral-500">Новых диалогов из базы — не больше 20 в сутки: так кандидаты не получают рассылок.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-11 text-sm text-neutral-400 hover:text-white">Отмена</button>
          <button onClick={send} disabled={busy || !text.trim()}
            className="px-5 h-11 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />} Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
