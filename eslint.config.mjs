import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Next's recommended rules, including the TypeScript set, over the whole of `src` — the
 * web app, the API under `src/server` and the shared code under `src/shared`.
 *
 * Linting runs as part of `next build`, so a finding here fails the build rather than
 * waiting to be noticed.
 */
const config = [
  { ignores: ['.next/**', '.next-verify/**', '.next-build/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // A leading underscore marks something deliberately unused — a destructured field
      // being dropped, a handler argument the signature requires.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Mongoose middleware and bulk-write shapes are typed loosely at a few boundaries in
      // `src/server`, each with a comment saying why. The rule would flag every one.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
