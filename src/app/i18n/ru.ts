export const ru = {
  appTitle: 'Illustration Composer',
  appSubtitle: 'Сборка изометрических иллюстраций из готовой векторной библиотеки',
  phaseBadge: 'Фаза 0 · каркас',
  statusTitle: 'Каркас проекта собран',
  statusBody:
    'Приложение, тесты и структура каталогов готовы. Осталось добавить исходники — после этого запускается ингест библиотеки.',
  sourcesTitle: 'Исходники, которые нужно добавить',
  sourcesHint:
    'Файлы кладутся один раз и не изменяются. Пути и имена важны: ингест ищет их по этим адресам.',
  tipsTitle: 'Быстрая проверка',
  tips: [
    'pnpm dev — запустить приложение',
    'pnpm verify — типы, линт и тесты',
    'pnpm ingest — собрать каталог (после добавления исходников)',
  ],
  footer: 'Illustration Composer · тестовое задание · Phase 0',
  sources: [
    {
      path: 'data/source/library/library-L.svg',
      note: 'Лист «Размер L» (экспорт Figma с id)',
    },
    {
      path: 'data/source/library/library-S.svg',
      note: 'Лист «Размер S» (экспорт Figma с id)',
    },
    {
      path: 'data/source/examples/composition-examples.svg',
      note: 'Страница «Примеры композиций» (Section_1.svg)',
    },
    {
      path: 'data/source/reference-drop/assembled-L.svg',
      note: 'SVG-drop · Собранно · L · 1200×630',
    },
    {
      path: 'data/source/reference-drop/assembled-S.svg',
      note: 'SVG-drop · Собранно · S · 1200×630',
    },
    {
      path: 'data/source/reference-drop/offset-L.svg',
      note: 'SVG-drop · Со смещением · L',
    },
    {
      path: 'data/source/reference-drop/offset-S.svg',
      note: 'SVG-drop · Со смещением · S',
    },
    {
      path: 'data/source/reference-drop/title-space-S.svg',
      note: 'SVG-drop · Под заголовок · S',
    },
    {
      path: 'data/source/reference-drop/title-space-L.png',
      note: 'SVG-drop · Под заголовок · L (только PNG, справочно)',
    },
    {
      path: 'docs/brief/task.pdf',
      note: 'Задача.pdf — исходное описание задания',
    },
    {
      path: 'docs/brief/intro.pdf',
      note: 'Вводная_информация.pdf — вводные материалы',
    },
    {
      path: 'docs/reference/library-L.png',
      note: 'PNG-превью листа L (только для глаз)',
    },
    {
      path: 'docs/reference/library-S.png',
      note: 'PNG-превью листа S (только для глаз)',
    },
    {
      path: 'docs/reference/composition-rules.png',
      note: 'Скриншот «Варианты композиций»',
    },
    {
      path: 'docs/reference/composition-examples.png',
      note: 'Скриншот примеров композиций',
    },
  ],
} as const;
