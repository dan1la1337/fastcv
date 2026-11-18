"""Повтор HTTP-запроса с паузой: для API без ИИ («Работа России», SuperJob).

Повторяем то, что проходит само: обрыв связи, таймаут, 429 и ответы 5xx.
Ошибки запроса (400, 403, 404) не повторяем: второй такой же запрос ответит тем же.
"""

from __future__ import annotations

import time
from typing import Callable

import requests

ATTEMPTS = 3
BACKOFF_SECONDS = 2.0   # пауза перед повтором: 2 с, затем 4 с
RETRY_STATUSES = {429, 500, 502, 503, 504}


def get(session_get: Callable[..., requests.Response], url: str, *, attempts: int = ATTEMPTS,
        backoff: float = BACKOFF_SECONDS, sleep: Callable[[float], None] | None = None,
        **kwargs) -> requests.Response:
    """session_get(url, **kwargs) с повторами. Возвращает успешный ответ или бросает
    последнюю ошибку (requests.RequestException), как обычный запрос с raise_for_status()."""
    for attempt in range(attempts):
        try:
            response = session_get(url, **kwargs)
            if response.status_code not in RETRY_STATUSES or attempt + 1 == attempts:
                response.raise_for_status()
                return response
        except (requests.ConnectionError, requests.Timeout):
            if attempt + 1 == attempts:
                raise
        (sleep or time.sleep)(backoff * 2 ** attempt)
    raise AssertionError("unreachable")
