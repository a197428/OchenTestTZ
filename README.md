# Illustration Composer

Веб-сервис сборки изометрических иллюстраций из фиксированной библиотеки
(10 предметов × 2 состояния). Сервис не генерирует новые объекты: итог собирается
только из исходных SVG-компонентов и остаётся редактируемым вектором.

> Статус: **Фаза 2 — ингест примеров**. Полный README с описанием архитектуры,
> хранения и переиспользования SVG-элементов будет собран в Фазе 7 (см. `CLAUDE.md`, раздел 16).

## Запуск

```bash
pnpm install
pnpm dev
```

## Команды

| Команда          | Назначение                                   |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Vite dev-сервер                              |
| `pnpm build`     | Проверка типов и production-сборка           |
| `pnpm typecheck` | `tsc --noEmit`                               |
| `pnpm lint`      | ESLint, включая границы `core` → `app`       |
| `pnpm test`      | Vitest                                       |
| `pnpm e2e`       | Playwright (после установки браузеров)       |
| `pnpm ingest`    | Сборка каталога и фрагментов из исходных SVG |
| `pnpm facts`     | Проверка фактов о библиотеке и generated     |
| `pnpm verify`    | `typecheck + lint + facts + test`            |

## Исходные файлы

Все исходники кладутся вручную и не изменяются:

```
data/source/library/library-L.svg
data/source/library/library-S.svg
data/source/examples/composition-examples.svg
data/source/reference-drop/assembled-L.svg
data/source/reference-drop/assembled-S.svg
data/source/reference-drop/offset-L.svg
data/source/reference-drop/offset-S.svg
data/source/reference-drop/title-space-S.svg
data/source/reference-drop/title-space-L.png
docs/brief/task.pdf
docs/brief/intro.pdf
docs/reference/*.png
```

Подробный список с соответствием исходным именам — в `docs/PROGRESS.md`.

## Документация

- `CLAUDE.md` — главный источник контекста и плана.
- `docs/ARCHITECTURE.md` — архитектура (заполняется в Фазе 7).
- `docs/DECISIONS.md` — принятые решения и допущения.
- `docs/PROGRESS.md` — журнал фаз.
- `docs/AI_TOOLS.md` — журнал AI-инструментов.
