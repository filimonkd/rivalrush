import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/web/test-results/**',
      'apps/web/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: [
      'apps/server/**/*.ts',
      'packages/shared/**/*.ts',
      '**/*.config.{js,ts}',
      'scripts/**/*.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Game plugins are pure rules: no network, database, Telegram or framework imports.
    files: ['apps/server/src/games/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'socket.io', 'mongoose', 'mongodb', 'pino', 'node:http', 'http'],
              message: 'Game plugins must be pure: no framework, network or database imports.',
            },
            {
              group: [
                '**/rooms/**',
                '**/websocket/**',
                '**/http/**',
                '**/db/**',
                '**/auth/**',
                '**/users/**',
                '**/matches/**',
              ],
              message: 'Game plugins must not depend on server infrastructure.',
            },
          ],
        },
      ],
    },
  },
);
