import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  {
    files: ['**/*.ts', '**/*.mjs'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'max-len': ['error', { code: 160 }],
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],

      // `||` and `??` differ for '' and 0, which readings and values are all the time. the
      // operator is chosen per case and not by rule.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // mappings, the reading cache and the subscriptions are dictionaries entries are removed from
      '@typescript-eslint/no-dynamic-delete': 'off',
      // asks for the `!` that no-non-null-assertion forbids
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      // log lines are put together with +, from text, numbers and values that may be missing
      '@typescript-eslint/restrict-plus-operands': ['error', {
        allowAny: false, allowBoolean: true, allowNullish: true, allowNumberAndString: true, allowRegExp: false,
      }],
      // String.match fails for a value that is not text where RegExp.exec would convert it.
      // readings are matched with the former, and which of the two happens is behaviour.
      '@typescript-eslint/prefer-regexp-exec': 'off',
    },
  },

  // these suites were taken over from homebridge-fhem. their checks are written against
  // mappings that are assumed to exist, which is what they assert.
  {
    files: ['test/hmccu/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
    },
  },
);
