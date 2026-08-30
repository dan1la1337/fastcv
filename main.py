import os
import hashlib
import json
import time
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai

# Загружаем переменные окружения
load_dotenv(".env.local")
load_dotenv(".env")

supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
gemini_key = os.getenv("GEMINI_API_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("Не найдены ключи Supabase! Проверьте .env или .env.local")

supabase: Client = create_client(supabase_url, supabase_key)
ai_client = genai.Client(api_key=gemini_key)

def normalize_vacancy_with_ai(raw_text: str) -> dict:
    prompt = f'''
    Ты бэкенд-нормализатор вакансий. Проанализируй текст и верни строго валидный JSON без markdown (без ```json).
    Если текст не является вакансией о работе, верни: {{"is_job": false}}

    Если это вакансия, заполни структуру:
    {{
        "is_job": true,
        "title": "Название должности",
        "description": "Краткое саммари требований, обязанностей и условий (2-3 предложения)",
        "salary_min": число_или_null,
        "salary_max": число_или_null,
        "city": "Город или null",
        "is_remote": true_или_false,
        "contact_type": "telegram" или "email",
        "contact_value": "username_без_собачки_или_почта_или_ссылка"
    }}

    Текст:
    {raw_text}
    '''
    try:
        response = ai_client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt
        )
        clean_text = response.text.replace("```json", "").replace("```", "").strip()
        return json.loads(clean_text)
    except Exception as e:
        print(f"  [AI Error] Ошибка генерации: {e}")
        return {"is_job": False}

def process_and_save_vacancy(raw_text: str, source_channel: str):
    raw_hash = hashlib.sha256(raw_text.encode('utf-8')).hexdigest()
    
    existing = supabase.table("vacancies").select("id").eq("raw_hash", raw_hash).execute()
    if existing.data:
        print("  [Skip] Дубликат, уже сохранено.")
        return

    print("  [AI] Анализ и нормализация...")
    parsed = normalize_vacancy_with_ai(raw_text)
    if not parsed.get("is_job", False):
        print("  [Ignore] Сообщение не является вакансией.")
        return

    payload = {
        "raw_hash": raw_hash,
        "title": parsed.get("title", "Без названия"),
        "description": parsed.get("description", ""),
        "salary_min": parsed.get("salary_min"),
        "salary_max": parsed.get("salary_max"),
        "city": parsed.get("city"),
        "is_remote": parsed.get("is_remote", False),
        "contact_type": parsed.get("contact_type"),
        "contact_value": parsed.get("contact_value"),
        "ranking_weight": 1.0,
        "source_type": "external"
    }
    
    supabase.table("vacancies").insert(payload).execute()
    print(f"  [Saved] ✅ {parsed.get('title')} (из @{source_channel})")

def fetch_channel(channel_name: str, limit: int = 3):
    clean_channel = str(channel_name).strip().lstrip("@")
    url = "https://t.me/s/" + clean_channel
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            print(f"⚠️ Не удалось получить посты @{clean_channel} (Status: {resp.status_code})")
            return
        soup = BeautifulSoup(resp.text, "html.parser")
        messages = soup.find_all("div", class_="tgme_widget_message_text")
        print(f"\n📡 Канал @{clean_channel}: найдено постов {len(messages)}. Сканируем последние {limit}...")
        for msg in messages[-limit:]:
            raw_text = msg.get_text(separator="\n").strip()
            if len(raw_text) > 40:
                process_and_save_vacancy(raw_text, clean_channel)
                time.sleep(2)
        
        # Обновляем время последней проверки канала в БД
        supabase.table("channels").update({"last_parsed_at": "now()"}).eq("username", clean_channel).execute()
    except Exception as e:
        print(f"⚠️ Ошибка запроса к @{clean_channel}: {e}")

def run_ingestion_cycle():
    print("\n==================== ЗАПУСК СБОРА ====================")
    print("Запрашиваем активные каналы из базы данных...")
    
    response = supabase.table("channels").select("username").eq("is_active", True).execute()
    
    if not response.data:
        print("⚠️ Нет активных каналов в базе.")
        return
        
    channels = [row["username"] for row in response.data]
    print(f"Найдено каналов для парсинга: {len(channels)}")
    
    for channel in channels:
        fetch_channel(channel, limit=3)
        time.sleep(2)
    print("==================== ЦИКЛ ЗАВЕРШЕН ====================\n")

if __name__ == "__main__":
    run_ingestion_cycle()