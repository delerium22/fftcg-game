import tseslint from 'typescript-eslint'
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.tsbuild/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  // Tests reuse `let` bindings across repeated array-destructuring assignments (`;[s, f] = withField(...)`),
  // which the default prefer-const 'any' mode flags per-variable even though the shared `s` can't be const.
  { files: ['**/test/**/*.ts'], rules: { 'prefer-const': ['error', { destructuring: 'all' }] } },
)
