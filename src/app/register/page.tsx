'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, UserCircle, ArrowRight } from 'lucide-react';

export default function RoleSelectionPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<'candidate' | 'employer' | null>(null);

  const handleContinue = () => {
    if (selectedRole) {
      router.push(`/register/form?role=${selectedRole}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Добро пожаловать в FastCV</h1>
          <p className="text-gray-500">Выберите, с какой целью вы здесь, чтобы мы настроили платформу под вас.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mt-8">
          <button
            onClick={() => setSelectedRole('candidate')}
            className={`relative p-8 rounded-2xl border-2 text-left transition-all duration-200 ${
              selectedRole === 'candidate'
                ? 'border-blue-600 bg-blue-50/50 shadow-md flex-col'
                : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${selectedRole === 'candidate' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                <UserCircle size={28} />
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedRole === 'candidate' ? 'border-blue-600' : 'border-gray-300'}`}>
                {selectedRole === 'candidate' && <div className="w-3 h-3 bg-blue-600 rounded-full" />}
              </div>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Ищу работу</h3>
            <p className="text-gray-500 text-sm">Хочу создать AI-резюме, автоматизировать отклики и найти работу мечты.</p>
          </button>

          <button
            onClick={() => setSelectedRole('employer')}
            className={`relative p-8 rounded-2xl border-2 text-left transition-all duration-200 ${
              selectedRole === 'employer'
                ? 'border-blue-600 bg-blue-50/50 shadow-md flex-col'
                : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${selectedRole === 'employer' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                <Briefcase size={28} />
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedRole === 'employer' ? 'border-blue-600' : 'border-gray-300'}`}>
                {selectedRole === 'employer' && <div className="w-3 h-3 bg-blue-600 rounded-full" />}
              </div>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Ищу сотрудника</h3>
            <p className="text-gray-500 text-sm">Хочу размещать вакансии и находить топовых специалистов для своих проектов.</p>
          </button>
        </div>

        <button
          disabled={!selectedRole}
          onClick={handleContinue}
          className={`mt-10 inline-flex items-center justify-center px-8 py-3 rounded-xl font-medium transition-all duration-200 ${
            selectedRole
              ? 'bg-gray-900 text-white hover:bg-gray-800 shadow-md hover:shadow-lg'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Продолжить <ArrowRight className="ml-2" size={18} />
        </button>

        {/* НОВАЯ ССЫЛКА НА ВХОД */}
        <div className="mt-8 text-center text-sm text-gray-500">
          Уже есть аккаунт?{' '}
          <a href="/login" className="text-blue-600 hover:underline font-medium">
            Войти
          </a>
        </div>

      </div>
    </div>
  );
}