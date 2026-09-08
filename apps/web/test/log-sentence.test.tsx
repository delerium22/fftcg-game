import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { EventLog } from '../src/ui/EventLog.js'

/** Rung K3: a log line opens with a capital, whatever case the narrator's possessive name carries. */
describe('the game log renders every line as a sentence (K3)', () => {
  it('capitalises the first character and leaves the rest alone', () => {
    // jsdom has no layout: the log's scroll-to-end effect calls a method jsdom does not define.
    Element.prototype.scrollIntoView ??= () => {}
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(EventLog, { log: [
        { kind: 'event', text: 'your Cloud gets +3000 power until the end of the turn' },
        { kind: 'event', text: "the AI's Sphene is broken by Lightning" },
        { kind: 'ai', text: 'The AI: Pass' },
      ] }))
    })
    const lines = Array.from(host.querySelectorAll('[role="log"] p')).map((p) => p.textContent)
    expect(lines).toEqual(['Your Cloud gets +3000 power until the end of the turn', "The AI's Sphene is broken by Lightning", 'The AI: Pass'])
    act(() => { root.unmount() })
    host.remove()
  })
})
