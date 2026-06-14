/**
 * Configuration ESLint minimale (P1.3).
 *
 * Objectif : détecter les erreurs claires (variables non utilisées dans le code
 * de production, parenthèses manquantes, typos courants) sans imposer un style
 * trop strict ni bloquer le développement avec des règles cosmétiques.
 *
 * Pour étendre les règles plus tard, ajouter `eslint:recommended` ou
 * `plugin:@typescript-eslint/recommended-type-checked` et corriger
 * progressivement les warnings.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true
      }
    ],
    'no-undef': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-condition': ['warn', { checkLoops: false }],
    'no-useless-escape': 'warn',
    'no-prototype-builtins': 'warn',
    'no-case-declarations': 'off',
    // react-hooks : on garde les règles en `warn` pour ne pas bloquer le build.
    'react-hooks/rules-of-hooks': 'warn',
    'react-hooks/exhaustive-deps': 'warn'
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'dist-electron/',
    'release/',
    'mobile/',
    '*.config.js',
    '*.config.cjs',
    '*.config.ts',
    '.eslintrc.cjs'
  ]
};
