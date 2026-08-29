import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The workspace packages are published as raw TypeScript (`main: src/index.ts`), so Vite must be
// allowed to pull them out of the monorepo root rather than treating them as prebuilt deps.
export default defineConfig({
  plugins: [react()],
  // A DOM for the tests that must RENDER: `renderToStaticMarkup` never runs an effect, so anything about what
  // the hook publishes across a commit — the AI-thinking flag was exactly that — is invisible without one.
  test: {
    environment: 'jsdom',
    // `e2e/` belongs to Playwright, which vitest would otherwise collect and choke on. The two runners
    // answer different questions: jsdom for everything it can honestly see, a real browser for the claims
    // it cannot — modality, inertness, tab traversal, layout overflow.
    // EXTEND the defaults, never replace them. Writing the list out by hand drops vitest's own exclusions
    // (config files, cache directories) and silently changes what is collected for reasons unrelated to the
    // one directory this is about.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
})
