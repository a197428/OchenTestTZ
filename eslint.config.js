import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'data/**',
      'examples/**',
      'api/compose-intent.js',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    settings: {
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/**' },
        { type: 'app', pattern: 'src/app/**' },
      ],
    },
    plugins: { boundaries },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              disallow: { to: { element: { type: 'app' } } },
              message: 'src/core must not import from src/app',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must stay DOM-free' },
        { name: 'document', message: 'src/core must stay DOM-free' },
        { name: 'localStorage', message: 'src/core must stay DOM-free' },
        { name: 'navigator', message: 'src/core must stay platform-free' },
        { name: 'fetch', message: 'src/core must stay platform-free' },
      ],
    },
  },
);
