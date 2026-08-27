/**
 * D2-A2 / D2-A6 / D2-A7 — the production-preview measurement, as a committed harness.
 *
 * This is the page-side half: it instruments the browser, drives a full game, and returns raw counts. Run it
 * against a PRODUCTION PREVIEW, never the dev server — the dev server takes a different bundler path, and the
 * whole point of D2-A7 is that the emitted worker chunk loads and runs when actually served:
 *
 *   pnpm --filter @fftcg/web build
 *   pnpm --filter @fftcg/web preview --port 5310
 *
 * then, in a browser on that page, evaluate `instrument()`, then `await drive()`. Any driver will do (this
 * repo has no Playwright dependency and does not need one); what matters is that the numbers below come from
 * the served build.
 *
 * WHAT IT ANSWERS, and what it does not:
 *
 *  - `searchesPosted` / `resultsReceived` / `workerErrors` — whether the worker actually did the work.
 *  - `aiCommitsCommitted` — how many AI commands were really applied, counted from `log__line--ai`, which the
 *    hook appends once per committed command. Posts and results alone cannot support "ISMCTS played this
 *    game": a result that is dropped as stale, or refused as illegal, still counts as received.
 *  - `longTasks` — main-thread tasks the browser reported. Any entry is >= 50 ms by definition, so an empty
 *    list means "no task at or over 50 ms was observed", NOT "the main thread was never blocked".
 *  - `maxFrameGapMs` — the largest gap between animation frames. This is the load-bearing number: the search
 *    is synchronous, so had it run on the main thread the gap would be at least its own duration.
 *  - `inputDelays` — real input only. Synthetic `.click()` dispatches synchronously and measures nothing, so
 *    the probe button must be clicked by the driver, and the figure read from PerformanceEventTiming.
 *  - `requestBytes` — the size of the WHOLE search request, not the incremental cost of `defs` (D2-2). To
 *    attribute that specifically, measure again with the field removed.
 */

/**
 * Install the observers. Must run BEFORE the first AI decision, because that is when the app lazily builds
 * its worker — and patching `Worker` afterwards observes nothing.
 *
 * Whether that is achievable depends on the driver: evaluating this after page load usually wins the race,
 * but when the AI moves first it does not. `summarise` therefore refuses to report a run it can prove it
 * missed, rather than returning zeros that read exactly like a broken worker.
 *
 * Injecting before app boot is the reliable fix, but note the trap: this file is an ES module, so handing it
 * straight to Playwright's `page.addInitScript` fails with "Unexpected token 'export'" — the injection is
 * silently a no-op and the run is blind again, exactly as if nothing had been tried. Strip the `export`
 * keywords for that path, and trust `instrumentationValid` either way.
 */
export function instrument() {
  const w = window
  const m = (w.__d2 = {
    longTasks: [], maxFrameGapMs: 0, inputDelays: [],
    trips: [], requestBytes: [], postMs: [],
    workersConstructed: 0, workerUrl: null, resultsReceived: 0, workerErrors: 0,
  })

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) m.longTasks.push(Math.round(e.duration))
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    m.longTaskUnsupported = true
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'click') m.inputDelays.push(Math.round(e.processingStart - e.startTime))
      }
    }).observe({ type: 'event', durationThreshold: 16 })
  } catch {
    m.eventTimingUnsupported = true
  }

  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    m.maxFrameGapMs = Math.max(m.maxFrameGapMs, Math.round(now - last))
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Wrap the constructor so every message in and out is timed. The app builds its worker lazily, on the first
  // AI decision, so this is in place before there is anything to observe.
  const Real = w.Worker
  w.Worker = class extends Real {
    constructor(url, opts) {
      super(url, opts)
      m.workersConstructed++
      m.workerUrl = String(url)
      const pending = new Map()
      const realPost = this.postMessage.bind(this)
      this.postMessage = (msg, ...rest) => {
        let bytes = null
        try { bytes = new Blob([JSON.stringify(msg)]).size } catch { /* not JSON-representable */ }
        const t0 = performance.now()
        realPost(msg, ...rest)
        if (msg && msg.type === 'search') {
          m.requestBytes.push(bytes)
          m.postMs.push(Number((performance.now() - t0).toFixed(2)))
          pending.set(msg.requestId, t0)
        }
      }
      this.addEventListener('message', (e) => {
        const d = e.data
        if (!d) return
        if (d.type === 'result') {
          m.resultsReceived++
          const t0 = pending.get(d.requestId)
          if (t0 !== undefined) { m.trips.push(Math.round(performance.now() - t0)); pending.delete(d.requestId) }
        } else if (d.type === 'error') {
          m.workerErrors++
        }
      })
    }
  }

  // A harmless button, so input latency can be sampled while a search is in flight.
  const b = document.createElement('button')
  b.id = 'd2-probe'
  b.textContent = 'probe'
  b.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:9999;width:120px;height:40px;opacity:0.2'
  document.body.appendChild(b)
  return { ready: true, longTaskUnsupported: !!m.longTaskUnsupported }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const strip = () => [...document.querySelectorAll('.prompt__actions button')]
const label = (b) => b.textContent.trim()
const orphanRow = () =>
  [...document.querySelectorAll('.zone')].find((z) => z.querySelector('.zone__label')?.textContent === 'Choose a card')

/** Play the human seat until the game reaches a result. Returns the raw measurement. */
export async function drive({ maxSteps = 2000 } = {}) {
  const errors = []
  window.addEventListener('error', (e) => errors.push(String(e.message)))

  for (let i = 0; i < maxSteps && !document.querySelector('.banner'); i++) {
    await wait(15)
    if (!strip().length) continue      // the AI is thinking; leave the main thread alone
    let acted = false
    const orphan = orphanRow()?.querySelector('button.card')
    if (orphan) { orphan.click(); acted = true }
    if (!acted) {
      const action = strip().find((b) => !['Pass', 'Concede'].includes(label(b)))
      if (action) { action.click(); acted = true }
    }
    if (!acted) {
      const card = document.querySelector('.hand button.card, .table__seat button.card')
      if (card) {
        card.click()
        await wait(40)
        const action = strip().find((b) => !['Pass', 'Concede'].includes(label(b)))
        if (action) { action.click(); acted = true }
      }
    }
    if (!acted) {
      const pass = strip().find((b) => label(b) === 'Pass')
      if (pass) pass.click()
    }
    await wait(20)
  }
  return summarise(errors)
}

const pct = (a, p) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const max = (a) => (a.length ? Math.max(...a) : null)

export function summarise(errors = []) {
  const m = window.__d2
  // Only the SEARCH fallback, not every amber line: the log also warns about unimplemented card abilities,
  // and counting those as fallbacks would report a healthy worker as a failed one.
  const warnings = [...document.querySelectorAll('.log__line--warning')]
    .map((l) => l.textContent)
    .filter((t) => /background search|could not make a move/i.test(t))
  const aiCommits = document.querySelectorAll('.log__line--ai').length
  // The instrumentation is only meaningful if it was in place before the worker was built. AI commands with
  // no observed worker and no fallback warning means the app is using a worker this harness never saw — the
  // run is blind, not clean, and reporting `0 / 0 / 0` would look identical to a worker that never ran.
  const missed = m.workersConstructed === 0 && aiCommits > 0 && warnings.length === 0
  return {
    instrumentationValid: !missed,
    ...(missed
      ? { discard: 'the worker was constructed before this harness patched Worker — re-run, installing it before app boot' }
      : {}),
    finished: !!document.querySelector('.banner'),
    outcome: document.querySelector('.banner__title')?.textContent ?? null,
    jsErrors: errors,

    workersConstructed: m.workersConstructed,
    workerUrl: m.workerUrl,
    searchesPosted: m.requestBytes.length,
    resultsReceived: m.resultsReceived,
    workerErrors: m.workerErrors,
    // The correlation that actually supports "the search played this game".
    aiCommitsCommitted: aiCommits,
    searchFallbackWarnings: warnings,

    tripP50Ms: pct(m.trips, 0.5),
    tripP95Ms: pct(m.trips, 0.95),
    tripMaxMs: max(m.trips),

    longTaskCount: m.longTasks.length,
    worstLongTaskMs: max(m.longTasks) ?? 0,
    maxFrameGapMs: m.maxFrameGapMs,
    inputSamples: m.inputDelays.length,
    worstInputDelayMs: max(m.inputDelays),

    requestBytesMedian: pct(m.requestBytes, 0.5),
    requestBytesMax: max(m.requestBytes),
    postMsMax: max(m.postMs),
  }
}
