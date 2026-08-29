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
  /*
   * Generous, because each test plays a REAL game against the AI and its length varies with the AI's
   * decisions. The default 30s fired before the harness's own deadline could, so the harness could never
   * report its own clearer error and a slow-but-correct game read as a failure. This must stay comfortably
   * ABOVE the harness deadline so the binding constraint is the one with the useful message.
   */
  timeout: 180_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    // A pinned, unusual port with `--strictPort`. Vite silently walks to the next free port otherwise, so a
    // developer already running the app on 5173 would leave these tests waiting on a URL nothing serves.
    command: 'pnpm --filter @fftcg/web dev --port 5199 --strictPort',
    url: 'http://localhost:5199',
    /*
     * NEVER reuse. Not even locally, which is where it matters most.
     *
     * A responsive server on this port is accepted on trust, so a stale one serving an OLDER build makes a
     * mutation in the checkout irrelevant: Playwright never starts the current code, and both tests pass
     * against a modal that is no longer there. That is not a hypothetical — it is exactly how I verified
     * this suite could fail, and the verification was only sound because the running server happened to be
     * serving HEAD. A proof whose validity depends on a coincidence is not a proof.
     *
     * Guarding on `CI` protects the machine that needs it least. Starting our own server costs a few
     * seconds; a false green costs the whole point of having a browser suite.
     */
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
