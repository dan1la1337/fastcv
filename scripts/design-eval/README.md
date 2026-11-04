# Слепая оценка дизайна FastCV

Harness для совета `codex` и `claude`. Метод взят из pingdotgg/t3code (PR #24776, #24837, #24865, #25251, #25968). Рабочая папка `../fastcv-ui-climb/` лежит вне репозитория.

```bash
npx next build
node scripts/design-eval/check.mjs                # axe, горизонтальный скролл, ошибки консоли
node scripts/design-eval/capture.mjs ../fastcv-ui-climb/captures/round-N
node scripts/design-eval/pack.mjs N ../fastcv-ui-climb/captures/round-N
scripts/design-eval/review.sh N both              # или codex; повтор: review.sh N both -2
node scripts/design-eval/summarize.mjs N --target 9.0
```

- `seed.mjs` — разовая запись тестовых данных на staging. Результат: `data.json`. Больше ничего в harness не пишет.
- `references.mjs` — один проход по публичным страницам референсов. Снимки не коммитятся.
- `capture` и `check` читают: `guard()` в `scenes.mjs` гасит в браузере всё, кроме чтения и входа, и печатает журнал погашенного. Письмо Smart Apply подменено, ИИ не вызывается.

Пакет ограничен 59 картинками и 15 МБ на две сборки и референсы. Поэтому `pack` складывает кадры в листы: две вкладки на десктопе, три на телефоне. Каждый лист подписан своим путём: `codex` получает картинки без имён, а `claude` с одним инструментом Read не видит список файлов, поэтому пути перечислены и в брифе.
