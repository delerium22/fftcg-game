import { useEffect, useRef, type JSX } from 'react'
import type { LogLine } from '../game/types.js'

/**
 * The running narration of the game. It carries the one thing the board itself cannot show: spec B-A6's
 * `unimplementedAbility` warnings, so the "pool plays as vanilla until rung C" caveat is visible during play
 * rather than a silent surprise.
 */
export function EventLog({ log }: { log: LogLine[] }): JSX.Element {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [log])
  return (
    <div className="log">
      <div className="log__head"><span className="eyebrow">Game log</span></div>
      {/*
        * `role="log"` — the ARIA role for exactly this: a running, append-only narration. Without it the
        * lines arrive silently, `scrollIntoView` tells a sighted player where to look, and a screen-reader
        * player is never told what the AI did.
        *
        * Not a composed "here is what the AI did" summary, which was the alternative: `log` needs no
        * invented wording, and a summary would have added selection rules and prose to what is meant to be
        * an accessibility repair.
        */}
      {/*
        * `aria-label`, NOT `aria-labelledby` pointing at the visible heading — which is what I wrote first.
        * The heading is styled `text-transform: uppercase`, and Chromium applies CSS text-transform when it
        * computes an accessible name: the region came out named "GAME LOG". Some screen readers spell
        * all-caps text letter by letter, so a purely visual style would have decided how the region is
        * spoken. Found by asserting the browser's computed accessibility tree, not the DOM attributes.
        */}
      <div className="log__lines" role="log" aria-label="Game log">
        {log.map((l, i) => <p key={i} className={`log__line log__line--${l.kind}`}>{l.text}</p>)}
        <div ref={end} />
      </div>
    </div>
  )
}
