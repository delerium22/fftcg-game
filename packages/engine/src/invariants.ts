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
  if (c.frozen !== undefined && typeof c.frozen !== 'boolean') problems.push(`card ${c.id} in ${where} has a non-boolean frozen`)
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
    // Rung J8: the LB deck is a zone; an LB card may not linger in a zone the sweep empties (§15.2.8.4).
    ps.lbDeck.forEach((x) => { note(x.id, `P${p} lb`); if (typeof x.faceUp !== 'boolean') problems.push(`P${p} LB card ${x.id} has a non-boolean faceUp`) })
    // Mid-frame only is exempt (review L3): an ability's pending always pairs with an active frame, and a rule-owed
    // pending (a block, a hand-size discard, an EX Burst) follows a rule-process pass that swept.
    if (!state.resolution.active) {
      for (const zone of ['hand', 'breakZone', 'deck', 'removedFromGame'] as const) {
        for (const id of ps[zone]) if (state.defs[state.cards[id]?.code ?? '']?.limitBreak !== undefined) problems.push(`LB card ${id} is in P${p} ${zone} instead of the LB deck (§15.2.8.4)`)
      }
    }
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
    // Rung J4: a sixth Backup is legal exactly while §12.4.8's choice is owed by its controller.
    if (ps.backups.length > MAX_BACKUPS && !(state.pending?.kind === 'breakExcessBackups' && state.pending.player === p)) problems.push(`P${p} controls ${ps.backups.length} backups`)
  }
  // The stack is a zone (§7.12, rung J1): a Summon on it is in exactly one place, here — and a Summon still
  // declaring its choices on the way there (`resolution.placing`) is already off the hand and counts too.
  state.stack.forEach((item, i) => { if (item.kind === 'summon') note(item.card, `stack[${i}]`) })
  if (state.resolution.placing?.item.kind === 'summon') note(state.resolution.placing.item.card, 'placing')
  const all = Object.keys(state.cards).map(Number)
  if (seen.size !== all.length) problems.push(`${all.length} card instances but ${seen.size} placed in zones`)
  for (const id of all) if (!seen.has(id)) problems.push(`card ${id} is in no zone`)
  if ((state.attack !== null) !== (state.phase === 'attack')) problems.push(`attack state ${state.attack ? 'present' : 'absent'} in phase ${state.phase}`)
  // Rung J1-D10: `block` is the defender's decision and nothing else; the declaration step carries no combatants.
  if (state.attack?.step === 'block' && !state.result && state.pending?.kind !== 'declareBlock') problems.push('the block step owes no declareBlock')
  if (state.attack?.step === 'declaration' && (state.attack.attackers.length || state.attack.blocker !== null)) problems.push('combatants outside a combat')
  // Rung J3: the First Strike window sits between two batches of a BLOCKED battle, with the first batch held. A
  // decision CAN be owed in it: a zone-change trigger fired by the first batch's break is placed here and declares
  // (§15.2.3.3 bars casting and activating, not triggers — found by self-play, seed 119).
  if (state.attack?.step === 'firstStrike' && (state.attack.blocker === null || state.attack.heldDamage === undefined)) problems.push('a firstStrike step without a blocked battle or a held first batch')
  if (state.attack?.step === 'firstStrike' && state.attack.firstStrikers === undefined) problems.push('a firstStrike step without the fixed First Strike set (§15.2.3.2)')
  // The held batch lives only in the window, or in the `damage` step while the blocker's post-window split is owed.
  if (state.attack?.heldDamage !== undefined && state.attack.step !== 'firstStrike' && !(state.attack.step === 'damage' && state.pending?.kind === 'assignPartyDamage')) problems.push('a held first batch outside the First Strike window')
  if (state.result && state.pending) problems.push('pending decision after game over')

  // --- the resolution agenda (spec C1-A7) ---
  const r = state.resolution
  if (!Number.isInteger(r.steps) || r.steps < 0) problems.push(`resolution.steps is ${r.steps}`)
  if (r.steps > MAX_RESOLUTION_STEPS) problems.push(`resolution.steps ${r.steps} exceeds the ${MAX_RESOLUTION_STEPS} budget`)
  if (state.result && (r.active || r.queue.length || r.placing || r.resolvingFrame !== null)) problems.push('resolution work queued after game over')
  if (state.result && state.stack.length) problems.push('stack items waiting after game over')
  if (r.placing) { const it = r.placing.item; for (const f of it.kind === 'summon' ? it.frames : [it.frame]) checkFrame(problems, 'placing', f, state) }
  if (r.resolvingFrame !== null && state.stack.length === 0) problems.push('a stack frame is resolving but the stack is empty')
  if (r.active) checkFrame(problems, 'active', r.active, state)
  for (const f of r.queue) checkFrame(problems, 'queued', f, state)
  // --- the stack (rung J1) ---
  if (state.passes !== 0 && state.passes !== 1) problems.push(`passes is ${String(state.passes)}`)
  state.stack.forEach((item, i) => {
    if (item.kind === 'ability') checkFrame(problems, `stack[${i}]`, item.frame, state)
    else {
      if (!state.cards[item.card]) problems.push(`stack[${i}] holds unknown card ${item.card}`)
      for (const f of item.frames) checkFrame(problems, `stack[${i}]`, f, state)
    }
  })
  // An ability pending and the active frame are two halves of one suspension — neither may exist alone.
  // Every kind an ABILITY can suspend on. A new one must be added here or the invariant reports the frame as
  // orphaned — which is what it did, correctly, the moment C9 added `chooseFromDeck`.
  // G3's `chooseExBurst` is deliberately NOT here. It is asked BEFORE any frame exists — that is the whole
  // reason it needed its own kind — so pairing it with an active frame would report every legitimate offer as
  // an orphan.
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
