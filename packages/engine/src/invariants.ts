import type { GameState } from './state.js'
import { MAX_BACKUPS } from './state.js'

export function checkInvariants(state: GameState): string[] {
  const problems: string[] = []
  const seen = new Map<number, string>()
  const note = (id: number, where: string) => { const prev = seen.get(id); if (prev) problems.push(`card ${id} in both ${prev} and ${where}`); seen.set(id, where) }
  for (const p of [0, 1] as const) {
    const ps = state.players[p]
    ps.deck.forEach((id) => note(id, `P${p} deck`))
    ps.hand.forEach((id) => note(id, `P${p} hand`))
    ps.damageZone.forEach((id) => note(id, `P${p} damage`))
    ps.breakZone.forEach((id) => note(id, `P${p} break`))
    for (const zone of ['forwards', 'backups'] as const) {
      for (const c of ps[zone]) {
        note(c.id, `P${p} ${zone}`)
        if (c.damage < 0) problems.push(`card ${c.id} has negative damage`)
        const inst = state.cards[c.id]
        if (!inst || !state.defs[inst.code]) problems.push(`field card ${c.id} has no definition`)
      }
    }
    if (ps.backups.length > MAX_BACKUPS) problems.push(`P${p} controls ${ps.backups.length} backups`)
  }
  const all = Object.keys(state.cards).map(Number)
  if (seen.size !== all.length) problems.push(`${all.length} card instances but ${seen.size} placed in zones`)
  for (const id of all) if (!seen.has(id)) problems.push(`card ${id} is in no zone`)
  if ((state.attack !== null) !== (state.phase === 'attack')) problems.push(`attack state ${state.attack ? 'present' : 'absent'} in phase ${state.phase}`)
  if (state.result && state.pending) problems.push('pending decision after game over')
  return problems
}
