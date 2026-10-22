import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Briefcase, UserCircle } from 'lucide-react';

export const metadata: Metadata = { title: 'Регистрация — FastCV' };

const ROLES = [
  {
    role: 'candidate',
    icon: UserCircle,
    title: 'Ищу работу',
    text: 'Свежие вакансии из Telegram и от прямых работодателей. Сопроводительное письмо под каждую вакансию пишет ИИ.',
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
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center space-y-3">
          <Link href="/" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="bg-blue-600 text-white font-black px-2.5 py-1 rounded-lg text-sm tracking-tight shadow-lg shadow-blue-500/25">⚡ Fast<span className="text-blue-200">CV</span></span>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-white">Добро пожаловать в FastCV</h1>
          <p className="text-neutral-400">Выберите, зачем вы здесь. Тип аккаунта потом изменить нельзя.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {ROLES.map(({ role, icon: Icon, title, text }) => (
            <Link
              key={role}
              href={`/register/form?role=${role}`}
              className="group p-6 sm:p-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 hover:border-blue-500/60 hover:bg-neutral-900 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-xl bg-blue-600/15 text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Icon size={28} />
                </div>
                <ArrowRight className="w-5 h-5 text-neutral-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">{title}</h2>
              <p className="text-neutral-400 text-sm leading-relaxed">{text}</p>
            </Link>
          ))}
        </div>

        <p className="text-center text-sm text-neutral-400">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">Войти</Link>
        </p>
      </div>
    </div>
  );
}
