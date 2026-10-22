'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function RegisterFormContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const role = searchParams.get('role') === 'employer' ? 'employer' : 'candidate';
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role: role },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center space-y-3">
          <h2 className="text-2xl font-bold text-gray-900">Проверьте почту</h2>
          <p className="text-gray-500">
            Мы отправили письмо на <span className="font-medium text-gray-900">{email}</span>.
            Перейдите по ссылке из письма, чтобы подтвердить аккаунт.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Регистрация
        </h2>
        <p className="text-center text-gray-500 mb-6">
          {role === 'candidate' ? 'Создание профиля кандидата' : 'Создание профиля компании'}
        </p>

        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 outline-none"
              placeholder="Минимум 6 символов"
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-blue-400"
          >
            {loading ? 'Создаем аккаунт...' : 'Зарегистрироваться'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function RegistrationForm() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Загрузка...</div>}>
      <RegisterFormContent />
    </Suspense>
  );
}