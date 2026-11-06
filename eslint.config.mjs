import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'tests/baseline/expected/**', 'apps/api/prisma/migrations/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Kode lama masih memakai any; diturunkan bertahap, jadi peringatan dulu.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
    },
  },
);
