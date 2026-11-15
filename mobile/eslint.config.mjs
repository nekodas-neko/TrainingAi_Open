// The native app's lint (#3803). Kept apart from the root eslint.config.mjs, which extends
// `next/core-web-vitals` — Next.js and DOM rules that mean nothing in React Native, and a root
// install the mobile workflow does not have. A small set that passes today: the hooks rules,
// unused bindings, and the same UTC date-slicing ban the web tree has.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'android/**', 'ios/**', '.expo/**', 'modules/*/android/**', 'modules/*/ios/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Warn, as in the root config (next/core-web-vitals). 45 effects and memos list their dependencies
      // deliberately narrower than the rule wants; changing them changes when they re-run, which needs
      // the device to check. The lint script caps the count (--max-warnings) so it cannot grow.
      'react-hooks/exhaustive-deps': 'warn',
      // A leading underscore marks a binding that is unused on purpose, as in the root config.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring)$/][callee.object.callee.property.name='toISOString']",
          message:
            "Use todayInTz() or another helper from @trainingai/shared/date-utils — .toISOString().slice() is the UTC date, wrong before 10am AEST.",
        },
        {
          selector:
            "MemberExpression[property.value=0][object.callee.property.name='split'][object.callee.object.callee.property.name='toISOString']",
          message:
            "Use todayInTz() or another helper from @trainingai/shared/date-utils — .toISOString().split('T') is the UTC date, wrong before 10am AEST.",
        },
      ],
    },
  },
];
