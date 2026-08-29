import { defineConfig } from '@playwright/test'

/**
 * Browser tests, for the claims jsdom cannot make.
 *
 * Deliberately NOT part of `pnpm test`. The default gate must stay runnable on a machine with no browser
 * installed, and these need a real one — that is the whole point of them. Run with `pnpm test:browser`.
 *
 * Three defects this session were visible only here and invisible to a green jsdom suite: a Break Zone of
 * 24 cards that laid out wider than its container and silently clipped the surplus; focus falling to
 * `document.body` after "Play again", because the render right after a restart has no button to take it; and
 * the whole modality claim of the game-over dialog, since this jsdom implements neither `showModal` nor
 * `inert`. Each was found by driving the browser by hand, and a hand-driven check does not re-run.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  // A failure here is a real defect, not a flake to be retried away.
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    // A pinned, unusual port with `--strictPort`. Vite silently walks to the next free port otherwise, so a
    // developer already running the app on 5173 would leave these tests waiting on a URL nothing serves.
    command: 'pnpm --filter @fftcg/web dev --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
