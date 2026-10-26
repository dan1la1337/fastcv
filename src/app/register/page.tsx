import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Briefcase, UserCircle } from 'lucide-react';

export const metadata: Metadata = { title: 'Регистрация — FastCV' };

const ROLES = [
  {
    role: 'candidate',
    icon: UserCircle,
    title: 'Ищу работу',
    text: 'Вакансии из Telegram, с сайтов компаний и от прямых работодателей. ИИ считает совпадение с вашим резюме и пишет сопроводительное письмо.',
  },
  {
    role: 'employer',
    icon: Briefcase,
    title: 'Ищу сотрудника',
    text: 'Публикуйте вакансии, получайте отклики с сопроводительным письмом и резюме и отвечайте кандидатам в кабинете.',
  },
] as const;

export default function RoleSelectionPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center space-y-3">
          <Link href="/" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="font-display font-bold text-lg tracking-tight text-neutral-100">fastcv</span>
          </Link>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">Добро пожаловать в FastCV</h1>
          <p className="text-neutral-400">Выберите, зачем вы здесь. Тип аккаунта потом изменить нельзя.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {ROLES.map(({ role, icon: Icon, title, text }) => (
            <Link
              key={role}
              href={`/register/form?role=${role}`}
              className="group p-6 sm:p-8 rounded-2xl border border-white/10 bg-neutral-900/50 hover:border-teal-300/60 hover:bg-neutral-900 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-xl bg-teal-300/15 text-teal-300 group-hover:bg-teal-300 group-hover:text-neutral-950 transition-colors">
                  <Icon size={28} />
                </div>
                <ArrowRight className="w-5 h-5 text-neutral-600 group-hover:text-teal-300 group-hover:translate-x-0.5 transition-all" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">{title}</h2>
              <p className="text-neutral-400 text-sm leading-relaxed">{text}</p>
            </Link>
          ))}
        </div>

        <p className="text-center text-sm text-neutral-400">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-teal-300 hover:text-teal-200 font-medium">Войти</Link>
        </p>
      </div>
    </div>
  );
}
