import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { PhaseTrack } from '../src/ui/PromptStrip'

describe('the phase tracker (spec section 6)', () => {
  it('lists the six phases and marks the current one, hidden from assistive technology', () => {
    const html = renderToStaticMarkup(createElement(PhaseTrack, { phase: 'attack' }))
    for (const label of ['Active', 'Draw', 'Main 1', 'Attack', 'Main 2', 'End']) expect(html).toContain(`>${label}<`)
    expect(html).toContain('aria-hidden="true"')
    expect(html.match(/phase-track__step--now/g)).toHaveLength(1)
    expect(html).toMatch(/phase-track__step--now[^>]*>Attack</)
  })

  it('marks nothing during setup', () => {
    expect(renderToStaticMarkup(createElement(PhaseTrack, { phase: 'setup' }))).not.toContain('phase-track__step--now')
  })
})
