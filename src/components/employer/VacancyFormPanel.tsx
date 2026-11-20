import { Loader2, Sparkles } from "lucide-react";
import type { VacancyForm } from "@/lib/employer";
import { inputClass, labelClass } from "@/components/employer/styles";
import DiscriminationWarning from "@/components/DiscriminationWarning";

/** Форма публикации и редактирования вакансии; для новой — ИИ-черновик по заметкам. */
export default function VacancyFormPanel({ editingId, form, setForm, notes, setNotes, drafting, onDraft, saving, onSubmit, onCancelEdit }: {
  editingId: string | null;
  form: VacancyForm;
  setForm: (form: VacancyForm) => void;
  notes: string;
  setNotes: (notes: string) => void;
  drafting: boolean;
  onDraft: () => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
}) {
  return (
    <div className="glass rounded-3xl p-6 sm:p-8 space-y-6">
      <h2 className="font-display text-lg font-bold">{editingId ? "Редактирование вакансии" : "Новая вакансия"}</h2>
      {!editingId && (
        <div className="rounded-2xl border border-teal-300/25 bg-teal-300/[0.06] p-4 space-y-3">
          <p className="text-sm text-neutral-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-300" /> Опишите вакансию парой фраз — ИИ напишет полный текст
          </p>
          <textarea rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Ищем мидл-бэкендера на Python в финтех, Django + Postgres, удалёнка, 250–300к"
            className={`${inputClass} resize-y`} />
          <button type="button" onClick={onDraft} disabled={drafting || notes.trim().length < 15}
            className="lg lg-accent inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-semibold disabled:opacity-50">
            {drafting ? <><Loader2 className="w-4 h-4 animate-spin" /> Пишем…</> : "Написать черновик"}
          </button>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Название должности</label>
          <input required maxLength={200} type="text" placeholder="Например: Senior Java Developer"
            value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputClass} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem] gap-4">
          <div>
            <label className={labelClass}>Зарплата от</label>
            <input type="number" min={0} placeholder="150000"
              value={form.salaryMin} onChange={e => setForm({ ...form, salaryMin: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Зарплата до</label>
            <input type="number" min={0} placeholder="250000"
              value={form.salaryMax} onChange={e => setForm({ ...form, salaryMax: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Валюта</label>
            <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className={inputClass}>
              {["RUB", "USD", "EUR", "KZT", "BYN", "UZS"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <div>
            <label className={labelClass}>Город</label>
            <input type="text" placeholder="Москва" value={form.city}
              onChange={e => setForm({ ...form, city: e.target.value })} className={inputClass} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer sm:pt-6">
            <input type="checkbox" checked={form.isRemote} onChange={e => setForm({ ...form, isRemote: e.target.checked })}
              className="w-5 h-5 accent-teal-300" />
            <span className="text-sm text-neutral-300">Возможна удалённая работа</span>
          </label>
        </div>

        <div>
          <label className={labelClass}>Технологии (через запятую)</label>
          <input type="text" placeholder="Python, Django, PostgreSQL" value={form.stack}
            onChange={e => setForm({ ...form, stack: e.target.value })} className={inputClass} />
        </div>

        <fieldset className="space-y-2">
          <legend className={labelClass}>Микро-блиц: до трёх вопросов кандидату (необязательно)</legend>
          <p className="text-xs text-neutral-500 -mt-1">Кандидат ответит на них вместе с письмом, а ИИ сделает выжимку ответов.</p>
          {form.questions.map((q, i) => (
            <input key={i} type="text" maxLength={200} aria-label={`Вопрос ${i + 1}`}
              placeholder={["Почему вам интересна эта вакансия?", "Был ли опыт с highload? Расскажите коротко", "Когда готовы выйти?"][i]}
              value={q} onChange={e => {
                const questions = [...form.questions] as [string, string, string];
                questions[i] = e.target.value;
                setForm({ ...form, questions });
              }} className={inputClass} />
          ))}
        </fieldset>

        <div>
          <label className={labelClass}>Обязанности и требования</label>
          <textarea required rows={6} placeholder="Опишите стек, проект и задачи кандидата..."
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            className={`${inputClass} leading-relaxed resize-y max-h-52`} />
        </div>

        <DiscriminationWarning text={`${form.title}\n${form.description}`} />

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="submit" disabled={saving}
            className="lg lg-accent flex-1 h-12 rounded-full text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : editingId ? "Сохранить изменения" : "Опубликовать"}
          </button>
          {editingId && (
            <button type="button" onClick={onCancelEdit}
              className="lg px-6 h-12 rounded-full text-sm text-neutral-300 hover:text-white">
              Отмена
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
