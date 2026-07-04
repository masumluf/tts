// Flat ESLint config (ESLint 9) enforcing skills.md TypeScript standards:
// strict types, no `any`, no unused vars. Rules are wired here in M1; they
// take effect as real code lands in later milestones.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // skills.md: "Do not add `any` or `as any`."
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // skills.md: explicit return types on public service methods.
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
    },
  },
);
