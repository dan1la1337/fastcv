'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { authErrorText } from '@/lib/auth-errors';
import { LEGAL_VERSION } from '@/lib/legal';

const card = 'max-w-md w-full bg-neutral-900/50 border border-neutral-800 rounded-2xl p-8 shadow-2xl';
const input = 'w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-teal-300 transition-colors';
const label = 'block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2';

function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 mb-6 hover:opacity-80 transition-opacity">
      <span className="font-display font-bold text-lg tracking-tight text-neutral-100">fastcv</span>
    </Link>
  );
}

function RegisterFormContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const role = searchParams.get('role') === 'employer' ? 'employer' : 'candidate';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Согласие с соглашением и политикой: редакция и время — для подтверждения по 152-ФЗ
        data: { role, consent_version: LEGAL_VERSION, consent_at: new Date().toISOString() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(authErrorText(error.message));
      setLoading(false);
      return;
    }

    // Если в Supabase включено подтверждение почты, сессии ещё нет:
    // пользователь войдёт по ссылке из письма через /auth/callback.
    if (!data.session) {
      setAwaitingConfirmation(true);
      setLoading(false);
      return;
    }

    // Сразу после регистрации ведём заполнять профиль: без него
    // Smart Apply пишет пустое письмо, а у работодателя нет названия компании.
    router.push('/profile');
  };

  if (awaitingConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className={`${card} text-center space-y-4`}>
          <MailCheck className="w-10 h-10 text-teal-300 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Проверьте почту</h1>
          <p className="text-neutral-400 text-sm leading-relaxed">
            Мы отправили письмо на <span className="font-medium text-neutral-100">{email}</span>.
            Перейдите по ссылке из письма, чтобы подтвердить аккаунт.
          </p>
          <p className="text-neutral-500 text-xs">Письма нет? Проверьте папку «Спам».</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className={card}>
        <div className="text-center mb-8">
          <Logo />
          <h1 className="text-2xl font-bold text-white">Регистрация</h1>
          <p className="text-neutral-400 text-sm mt-2">
            {role === 'candidate' ? 'Профиль кандидата: отклики с письмом от ИИ' : 'Профиль компании: вакансии и отклики кандидатов'}
          </p>
        </div>

        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label htmlFor="email" className={label}>Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required className={input} placeholder="name@example.com" />
          </div>

          <div>
            <label htmlFor="password" className={label}>Пароль</label>
            <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
              required minLength={6} className={input} placeholder="Минимум 6 символов" />
          </div>

          <label className="flex items-start gap-3 text-xs text-neutral-400 leading-relaxed cursor-pointer">
            <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 rounded bg-neutral-950 border-neutral-700" />
            <span>
              Принимаю <Link href="/terms" target="_blank" className="text-teal-300 hover:underline">пользовательское соглашение</Link> и
              даю согласие на обработку персональных данных, в том числе их передачу за рубеж, на условиях{' '}
              <Link href="/privacy" target="_blank" className="text-teal-300 hover:underline">политики</Link>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-950/30 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !agreed}
            className="w-full flex items-center justify-center gap-2 bg-teal-300 hover:bg-teal-200 text-neutral-950 py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 mt-6"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Зарегистрироваться'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/register" className="inline-flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> Другая роль
          </Link>
          <Link href="/login" className="text-neutral-400 hover:text-white transition-colors">Уже есть аккаунт</Link>
        </div>
      </div>
    </div>
  );
}

export default function RegistrationForm() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <RegisterFormContent />
    </Suspense>
  );
}
