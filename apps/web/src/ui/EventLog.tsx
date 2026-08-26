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
      <div className="log__lines">
        {log.map((l, i) => <p key={i} className={`log__line log__line--${l.kind}`}>{l.text}</p>)}
        <div ref={end} />
      </div>
    </div>
  )
}
