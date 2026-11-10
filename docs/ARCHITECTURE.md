# ARCHITECTURE

> Заполняется в Фазе 7 (раздел 16 `CLAUDE.md`). Ниже — черновой каркас.

## Поток данных

```
Figma SVG ─ingest(1 раз)→ catalog + fragments + substrates + templates + relations
                                      │
 текст ─► intent (LLM|fallback|search) ─► items[] ─► layout ─► Scene(JSON)
                                                              │
                                  editor (store) ◄────────────┤
                                                              ▼
                              render (React SVG)   export (SVG serializer)
                                  recolor(Palette)──────────────┘
```

## Принципы

- **Scene — это JSON**, всё остальное — функции над ним.
- **Геометрия не меняется:** `d` объектов попадает в экспорт байт-в-байт; преобразования
  только через `transform` на обёртке `<g>`.
- **Цвета только через слоты** (`bg-*`, `obj-*`, `ink`, `white`); hex подставляется при
  рендере и экспорте.
- **Хранение:** уникальный рисунок один раз в `data/generated/fragments/<objectId>.<state>.<size>.json`;
  alias для фоновых объектов и S-вариантов, совпадающих с L.
- **Переиспользование:** объект сцены — ссылка (`objectId`, `state`) + трансформация;
  дубликаты не копируют геометрию.
- **Границы:** `src/core` без DOM/React; `src/app` — UI; `api/` — серверный LLM.

Подробнее — `CLAUDE.md`, разделы 5, 6, 11.
