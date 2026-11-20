"""Продакт- и проджект-менеджеры: направление по названию вакансии.

Направление «Продукт и проекты» (product) ставит и ИИ, и база по названию
(vacancy_direction в supabase/migrations), но оба ошибались: «Руководитель IT-проектов»,
«Delivery Lead», «Project Manager» у ИИ уходили в management, «Product Manager (AI)» — в
data_ml. Здесь правило для сборщика: роль менеджера продукта или проектов → product.

Не ИТ-проекты (стройка, мероприятия, проектные продажи) правило не трогает. Продуктовый
аналитик остаётся в analytics. Источникам, где ИТ не гарантирован (SuperJob вне рубрики
«IT», «Работа России» вне ИТ-сферы), нужен ещё признак ИТ в названии: it_context=False.
"""

from __future__ import annotations

import re
from typing import Optional

PM_TITLE = re.compile(
    r"product[- ]?(manager|owner|lead|director)|head of product|\bcpo\b|chief product|"
    r"project[- ]?(manager|lead|director)|program(me)? manager|delivery[- ]?(manager|lead|director|менеджер)|product management|"
    r"scrum[- ]?(master|мастер)|скрам|agile[- ]?coach|аджайл|\b(it|ит)[- ]?pm\b|\bpm\b|\btpm\b|\bpo\b|"
    r"продакт|проджект|продукт[- ]менеджер|проектн\w* менеджер|продуктов\w* (лидер|стрим)|лидер\w* продуктов|менеджер\w* (\w+ )?продукт|продуктов\w* менеджер|"
    r"владел\w* продукт|директор\w* (по )?продукт|руководител\w* (\w+ )?продукт|"
    r"менеджер\w* (по )?(\w+[- ])?проект|"
    r"руководител\w* (\w+[- ])?проект|директор\w* (по )?((it|ит)[- ])?проект|"
    r"проектн\w* офис|управлени\w* проект|менеджер\w* программ|руководител\w* программ",
    re.I)
# Проекты не про ИТ и чужие роли с похожим названием
NOT_PM = re.compile(
    r"продаж|sales|аналитик|analyst|маркет|marketing|ассистент|assistant|\bhr\b|hr-|зарплатн|выставоч|юрист|карточн|\bsap\b|разработчик|developer|программист|риск|строител|строй|монтаж|ремонт|проектировщ|"
    r"проектирован|архитектур|дизайн-проект|мероприят|event|ивент|недвижим|девелоп|капитальн|"
    r"производств|завод|бренд|brand|категори|закуп|кредит|страхов|ипотек|грант|благотвор|"
    r"образовательн\w* проект|медицин|фарм|туризм|выставк|nfp|некоммерч", re.I)
# Признак ИТ в названии — для источников, где вакансия может быть не из ИТ
IT_HINT = re.compile(
    r"\b(it|ит)\b|it-|ит-|digital|диджитал|цифров|веб|web|онлайн|online|интернет|мобильн|mobile|"
    r"приложени|app\b|разработ|software|программн|saas|b2b|data|данных|\bai\b|\bml\b|\bии\b|"
    r"платформ|platform|crm|erp|1[сc]|внедрен|автоматизац|информационн|технич|technical|tech|"
    r"scrum|agile|delivery|продакт|product|project|program", re.I)
# Направления, которые правило поправляет: сюда ИИ и база относили менеджеров проектов
# и продукта. Геймдев не трогаем: продюсеры и менеджеры игр живут там по правилам ленты
FIXABLE = {None, "management", "other", "backend", "data_ml", "analytics", "support", "office",
           "marketing", "frontend", "fullstack", "mobile", "devops", "qa", "design", "security"}


def is_pm_title(title: Optional[str], it_context: bool = True) -> bool:
    """Название — роль менеджера продукта или ИТ-проектов."""
    title = title or ""
    if not PM_TITLE.search(title) or NOT_PM.search(title):
        return False
    return it_context or bool(IT_HINT.search(title))


def pm_direction(title: Optional[str], current: Optional[str], it_context: bool = True) -> Optional[str]:
    """product для роли менеджера продукта или проектов, иначе направление как было."""
    if current in FIXABLE and is_pm_title(title, it_context):
        return "product"
    return current
