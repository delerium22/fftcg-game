/**
 * The motion tokens, mirrored for JavaScript (UI overhaul spec section 7). `tokens.css` holds the same values as CSS
 * custom properties; `test/tokens.test.ts` fails if the two drift. Starting values, to be tuned faster in U9.
 */
export const DURATION_MS = Object.freeze({ instant: 70, fast: 140, base: 220, move: 320, reveal: 450, dramatic: 800 })
export type DurationToken = keyof typeof DURATION_MS

export const EASING = Object.freeze({
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  in: 'cubic-bezier(0.7, 0, 0.84, 0)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
})

/** Springs for Motion (U4): stiffness and damping, not durations, so an interrupted motion never jumps. */
export const SPRING = Object.freeze({
  snappy: { stiffness: 520, damping: 32 },
  hover: { stiffness: 380, damping: 26 },
  heavy: { stiffness: 260, damping: 22 },
})

/** A duration at the current speed: `scale` is `SPEED_SCALE[settings.speed]` (1, 0.6 or 0). */
export function durationMs(token: DurationToken, scale: number): number {
  return DURATION_MS[token] * scale
}
