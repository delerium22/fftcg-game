import type { Frame } from './abilities.js'
import { FIELD_FLAGS, MAX_RESOLUTION_STEPS } from './abilities.js'
import type { FieldCard, GameState } from './state.js'
import { MAX_BACKUPS } from './state.js'
import { KEYWORDS } from './types.js'

function checkFieldCard(problems: string[], where: string, c: FieldCard, state: GameState): void {
  // A `oncePerTurn` marker is only meaningful on a card that HAS such an ability, activated from the field.
  // This is what makes the spec's promise concrete: put `oncePerTurn` on an ability whose `sourceZone` is
  // `hand` or `breakZone` and there is no `FieldCard` to carry it, so it would silently never limit anything.
  if (new Set(c.usedThisTurn).size !== c.usedThisTurn.length) problems.push(`card ${c.id} in ${where} used an ability twice in one turn`)
  const def = state.defs[state.cards[c.id]?.code ?? '']
  for (const id of c.usedThisTurn) {
    const a = def?.abilities?.find((x) => x.id === id)
    if (!a) problems.push(`card ${c.id} in ${where} recorded unknown ability ${id} as used`)
    else if (a.trigger.kind !== 'activated' || !a.trigger.oncePerTurn) problems.push(`card ${c.id} in ${where} recorded ${id} as used, but it is not a oncePerTurn activated ability`)
    else if (a.trigger.sourceZone !== 'field') problems.push(`ability ${id} is oncePerTurn from ${a.trigger.sourceZone}, which has no FieldCard to track it`)
  }
  if (c.damage < 0) problems.push(`card ${c.id} has negative damage`)
  if (!Number.isInteger(c.powerBonus) || !Number.isFinite(c.powerBonus)) problems.push(`card ${c.id} in ${where} has non-integral powerBonus ${c.powerBonus}`)
  for (const f of c.flags) if (!FIELD_FLAGS.includes(f)) problems.push(`card ${c.id} has unknown flag ${String(f)}`)
  if (new Set(c.flags).size !== c.flags.length) problems.push(`card ${c.id} has duplicate flags`)
  for (const k of c.granted) if (!KEYWORDS.includes(k)) problems.push(`card ${c.id} has unknown granted keyword ${String(k)}`)
}

function checkFrame(problems: string[], where: string, f: Frame, state: GameState): void {
  if (!state.cards[f.source]) problems.push(`${where} frame ${f.abilityId} has unknown source ${f.source}`)
  if (f.path.some((i) => !Number.isInteger(i) || i < 0)) problems.push(`${where} frame ${f.abilityId} has a malformed program counter`)
  if (new Set(f.chosen).size !== f.chosen.length) problems.push(`${where} frame ${f.abilityId} chose a duplicate target`)
  if (new Set(f.modes).size !== f.modes.length) problems.push(`${where} frame ${f.abilityId} chose a duplicate mode`)
}

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
    // A zone added to `viewFor` but not here fails silently — `note` is what proves every card is in exactly
    // one place, and the fuzzer runs it after every command under --strict (spec C7-5).
    ps.removedFromGame.forEach((id) => note(id, `P${p} removed`))
    // Every card the turn recorded as reaching this Break Zone from the field must still BE there (spec
    // C10-2). A retrieve or a removal that forgot to prune shows up here rather than as a card Sphene can
    // take twice — and `note` above cannot see it, because this list is not a zone.
    if (new Set(ps.putIntoBreakZoneFromFieldThisTurn).size !== ps.putIntoBreakZoneFromFieldThisTurn.length) {
      problems.push(`P${p} recorded a duplicate Break Zone arrival`)
    }
    for (const id of ps.putIntoBreakZoneFromFieldThisTurn) {
      if (!ps.breakZone.includes(id)) problems.push(`card ${id} is recorded as put into P${p}'s Break Zone this turn but is not in it`)
    }
    for (const zone of ['forwards', 'backups'] as const) {
      for (const c of ps[zone]) {
        note(c.id, `P${p} ${zone}`)
        checkFieldCard(problems, `P${p} ${zone}`, c, state)
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

  // --- the resolution agenda (spec C1-A7) ---
  const r = state.resolution
  if (!Number.isInteger(r.steps) || r.steps < 0) problems.push(`resolution.steps is ${r.steps}`)
  if (r.steps > MAX_RESOLUTION_STEPS) problems.push(`resolution.steps ${r.steps} exceeds the ${MAX_RESOLUTION_STEPS} budget`)
  if (state.result && (r.active || r.queue.length || r.continuation)) problems.push('resolution work queued after game over')
  if (r.active) checkFrame(problems, 'active', r.active, state)
  for (const f of r.queue) checkFrame(problems, 'queued', f, state)
  // An ability pending and the active frame are two halves of one suspension — neither may exist alone.
  // Every kind an ABILITY can suspend on. A new one must be added here or the invariant reports the frame as
  // orphaned — which is what it did, correctly, the moment C9 added `chooseFromDeck`.
  const ABILITY_PENDINGS = ['chooseTargets', 'chooseMode', 'chooseFromDeck'] as const
  const abilityPending = ABILITY_PENDINGS.some((k) => state.pending?.kind === k)
  if (abilityPending && !r.active) problems.push(`pending ${state.pending?.kind} with no active frame`)
  if (r.active && !abilityPending) problems.push(`active frame ${r.active.abilityId} with no ability pending`)
  if (abilityPending && r.active && state.pending && state.pending.player !== r.active.controller) {
    problems.push(`pending ${state.pending.kind} is owed by P${state.pending.player} but the frame is controlled by P${r.active.controller}`)
  }
  if (state.pending?.kind === 'chooseTargets') {
    const { min, max, candidates } = state.pending
    if (new Set(candidates).size !== candidates.length) problems.push('chooseTargets candidates contain a duplicate')
    if (!(min <= max && max <= candidates.length)) problems.push(`chooseTargets bounds ${min}..${max} over ${candidates.length} candidates`)
    for (const id of candidates) if (!state.cards[id]) problems.push(`chooseTargets candidate ${id} is not a card`)
  }
  if (state.pending?.kind === 'chooseMode') {
    const { min, max, labels } = state.pending
    if (!(min <= max && max <= labels.length)) problems.push(`chooseMode bounds ${min}..${max} over ${labels.length} modes`)
  }
  return problems
}
