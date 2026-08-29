import tseslint from 'typescript-eslint'
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.tsbuild/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  // Tests reuse `let` bindings across repeated array-destructuring assignments (`;[s, f] = withField(...)`),
  // which the default prefer-const 'any' mode flags per-variable even though the shared `s` can't be const.
  { files: ['**/test/**/*.ts'], rules: { 'prefer-const': ['error', { destructuring: 'all' }] } },
  /*
   * `as never` is banned in tests, and the ban is not stylistic.
   *
   * Twice in one session a cast let a FIXTURE describe a state the engine cannot produce, and both times a
   * review found it rather than a failing test. One passed a `PlayerView` where `legalCommands` wanted a
   * `GameState`; the other built a blocking position with attackers left active though declaring an attack
   * dulls them, priority on the wrong player, invented fields and a required one missing. Both looked fine
   * and proved nothing, because the cast is exactly what stops the types objecting.
   *
   * Production code is not covered: `cp.ts` has a legitimate one for dispatching a discriminated union
   * through a lookup table, which TypeScript cannot narrow on its own. Fixtures have no such excuse — if a
   * fixture will not typecheck, that is the fixture being wrong about the domain, which is the whole risk.
   */
  {
    files: ['**/test/**/*.ts', '**/test/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'TSAsExpression > TSNeverKeyword',
        message: 'No `as never` in a fixture: it hides a state the engine cannot produce. Type it exactly, or the test proves nothing.',
      }],
    },
  },
)
