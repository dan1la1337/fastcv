"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Save } from "lucide-react";
import Link from "next/link";

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // Состояния формы
  const [name, setName] = useState("");
  const [role, setRole] = useState("candidate");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("");

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/login");
      return;
    }
    setUser(user);

    // Вытягиваем данные из таблицы profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profile) {
      setName(profile.name || "");
      setRole(profile.role || "candidate");
      setDescription(profile.description || "");
      setSkills(profile.skills ? profile.skills.join(", ") : "");
    }
    setLoading(false);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const skillsArray = skills.split(",").map(s => s.trim()).filter(Boolean);

    const payload = {
      id: user.id,
      name,
      role,
      description,
      skills: skillsArray,
    };

    const { error } = await supabase
      .from("profiles")
      .upsert(payload);

    if (error) {
      alert("Ошибка сохранения: " + error.message);
    } else {
      alert("Профиль успешно сохранен!");
    }
    setSaving(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="bg-blue-600 text-white font-black px-2.5 py-1 rounded-md text-xs tracking-widest shadow-lg shadow-blue-500/20">SJT</span>
            <span className="font-semibold">Job Aggregator</span>
          </Link>
          <button onClick={handleLogout} className="text-sm text-neutral-400 hover:text-white flex items-center gap-2 transition-colors">
            <LogOut className="w-4 h-4" /> Выйти
          </button>
        </div>

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <h1 className="text-2xl font-bold mb-6 text-white">Личный кабинет</h1>
          
          <form onSubmit={saveProfile} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Ваша роль</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors">
                <option value="candidate">Соискатель</option>
                <option value="employer">Работодатель</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Имя / Название компании</label>
              <input required type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Иван Иванов" className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors" />
            </div>

            {role === "candidate" && (
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Ключевые навыки (через запятую)</label>
                <input type="text" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, Node.js, Python..." className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors" />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">
                {role === "candidate" ? "Опыт работы и о себе" : "Описание компании"}
              </label>
              <textarea required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Подробно расскажите о вашем опыте..." className="w-full h-32 bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors resize-none leading-relaxed" />
            </div>

            <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 mt-4">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Сохранить профиль</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}