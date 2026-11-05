"""Клиент языковых моделей Yandex AI Studio (OpenAI-совместимый Chat Completions API).

Одна модель на весь проект: сайт (src/lib/ai.ts) и сборщик ходят в одно и то же место,
серверы в России. Переменные окружения — те же, что у сайта:
  YANDEX_API_KEY   — API-ключ сервисного аккаунта (роль ai.languageModels.user);
  YANDEX_FOLDER_ID — идентификатор каталога Yandex Cloud;
  YANDEX_AI_MODELS — необязательно: модели через запятую, по порядку перебора.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

import requests

ENDPOINT = "https://llm.api.cloud.yandex.net/v1/chat/completions"
DEFAULT_MODELS = ("qwen3-235b-a22b-fp8/latest", "yandexgpt/latest")


class APIError(Exception):
    """Ответ API с кодом ошибки: по коду решаем, пробовать ли следующую модель."""

    def __init__(self, code: int, message: str = ""):
        super().__init__(f"{code} {message}".strip())
        self.code = code


def models_from_env(default: tuple[str, ...] = DEFAULT_MODELS) -> tuple[str, ...]:
    raw = os.getenv("YANDEX_AI_MODELS") or ""
    return tuple(m.strip() for m in raw.split(",") if m.strip()) or default


def strip_reply(text: str) -> str:
    """Убираем блок рассуждений (<think>) и markdown-ограждение ```json … ```."""
    text = re.sub(r"<think>[\s\S]*?</think>", "", text or "", flags=re.IGNORECASE).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s*```$", "", text).strip()


def parse_json(text: str) -> Any:
    """JSON из ответа модели; если вокруг попал лишний текст — берём от первой скобки до последней."""
    body = strip_reply(text)
    try:
        return json.loads(body)
    except ValueError:
        starts = [i for i in (body.find("{"), body.find("[")) if i >= 0]
        end = max(body.rfind("}"), body.rfind("]"))
        if not starts or end <= min(starts):
            raise
        return json.loads(body[min(starts):end + 1])


def json_instruction(schema: dict) -> str:
    return ("\n\nОтвет — только JSON строго по этой JSON Schema, без markdown, пояснений и текста вокруг:\n"
            + json.dumps(schema, ensure_ascii=False))


class Client:
    def __init__(self, api_key: str, folder: str, timeout_ms: int = 60_000):
        self.api_key = api_key
        self.folder = folder
        self.timeout = timeout_ms / 1000

    def uri(self, model: str) -> str:
        return model if model.startswith("gpt://") else f"gpt://{self.folder}/{model}"

    def complete(self, *, model: str, system: str, user: str,
                 temperature: float = 0, max_tokens: Optional[int] = None) -> str:
        body: dict = {
            "model": self.uri(model),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
        }
        if max_tokens:
            body["max_tokens"] = max_tokens
        response = requests.post(
            ENDPOINT,
            json=body,
            headers={"Authorization": f"Api-Key {self.api_key}", "OpenAI-Project": self.folder,
                     "x-folder-id": self.folder},
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise APIError(response.status_code, response.text[:300])
        content = (response.json().get("choices") or [{}])[0].get("message", {}).get("content")
        text = strip_reply(content if isinstance(content, str) else "")
        if not text:
            raise ValueError("пустой ответ модели")
        return text
