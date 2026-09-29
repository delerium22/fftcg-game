import { useId, useMemo, type JSX } from 'react'
import type { Element } from '@fftcg/engine'
import { cardArt } from './crystalArt.js'

/**
 * The generative art for a card with no loaded scan. Decorative: the card's name, cost and power are on the frame,
 * so this is hidden from assistive technology. `useId` keeps each card's gradient id unique on a board of 30 cards.
 */
export function CardArt({ code, elements }: { code: string; elements: readonly Element[] }): JSX.Element {
  const key = elements.join('|')
  // `key`, not `elements`: callers pass a fresh array every render, and the art depends only on its values.
  const art = useMemo(() => cardArt(code, elements), [code, key])
  // React's ids contain characters (":", "«", "»") that break a `url(#…)` reference, so keep only the safe ones.
  const glowId = `${useId().replace(/[^A-Za-z0-9_-]/g, '')}-glow`
  return (
    <svg className="card__genart" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor={art.glow.fill} stopOpacity="0.55" />
          <stop offset="100%" stopColor={art.glow.fill} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={art.glow.cx} cy={art.glow.cy} r="55" fill={`url(#${glowId})`} />
      {art.shards.map((s, i) => (
        <polygon key={i} points={s.points} fill={s.fill} fillOpacity={s.opacity} stroke="rgb(255 255 255 / 0.35)" strokeWidth="0.6" />
      ))}
    </svg>
  )
}
