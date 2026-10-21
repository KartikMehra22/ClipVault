import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // Global ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      '**/*.tsbuildinfo',
      '**/*.d.ts',
    ],
  },
  // Base recommended JavaScript rules
  js.configs.recommended,
  // TypeScript recommended configurations
  ...tseslint.configs.recommended,
  // Base configuration for all JS / TS files
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Node.js environments (root config, desktop, api, database, scripts)
  {
    files: [
      '*.{js,mjs,cjs}',
      'scripts/**/*.{js,mjs,ts}',
      'apps/desktop/**/*.{js,ts}',
      'apps/api/**/*.{js,ts}',
      'packages/database/**/*.{js,ts}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Next.js & React presentation layer (apps/renderer)
  {
    files: ['apps/renderer/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
    },
    settings: {
      react: {
        version: 'detect',
      },
      next: {
        rootDir: 'apps/renderer',
      },
    },
  },
  // Shared contracts (universal runtime-agnostic)
  {
    files: ['packages/contracts/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.es2022,
      },
    },
  },
);
