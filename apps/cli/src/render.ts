import type { Ability, CardId, Command, FieldCard, PlayerView } from '@fftcg/engine'
import { describeAbilityCost, describeAbilityEffect, pickedDeckCards } from '@fftcg/engine'

const PHASE_LABEL: Record<string, string> = { setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase' }

function name(v: PlayerView, id: CardId): string {
  const inst = v.cards[id]
  if (!inst) return `#${id}`
  const d = v.defs[inst.code]
  return d ? `${d.name} (${d.code})` : inst.code
}
function fieldCard(v: PlayerView, c: FieldCard): string {
  const d = v.defs[v.cards[c.id]?.code ?? '']
  const power = d?.power != null ? ` ${d.power - c.damage}/${d.power}` : ''
  const flags = [c.status === 'dull' ? 'DULL' : '', c.attackedThisTurn ? 'attacked' : '', ...c.granted].filter(Boolean).join(',')
  return `[${c.id}] ${d?.name ?? '?'}${power}${flags ? ` {${flags}}` : ''}`
}

/**
 * WHY the terminal is asking, from the clause's own printed text.
 *
 * The browser answers this in two places — the button carries the verb, and a prompt above it carries the
 * fuller purpose — and the terminal has only a numbered menu. So it offered "0: Target Lightning (27-127S)"
 * with nothing saying whether that Lightning was about to be dulled, damaged, broken or buffed; found by
 * playing, at 5 of 7 damage, where the answer decides the game.
 *
 * The first attempt at this was to move the browser's verb-building into the engine and call it per option.
 * A plan review refused that, and was right: the browser deliberately DROPS detail from the button because
 * its prompt carries the rest, so the terminal would have inherited "Protect Cloud" and still not said what
 * Cloud was being protected from. Printing the clause instead needs no invented English at all — the card
 * already says it, and `describeAbilityEffect` already extracts the effect half.
 */
export function askingBecause(v: PlayerView): string | null {
  const frame = v.resolution.active
  if (!frame) return null
  const code = v.cards[frame.source]?.code
  const ability = code === undefined ? undefined : v.defs[code]?.abilities?.find((a) => a.id === frame.abilityId)
  if (!ability) return null
  const effect = describeAbilityEffect(ability)
  return effect === null ? null : `  ${name(v, frame.source)} — ${effect}`
}

export function renderView(v: PlayerView): string {
  const opp = v.me === 0 ? 1 : 0
  const step = v.attack ? ` / ${v.pending?.kind === 'assignPartyDamage' ? 'assign party damage' : v.attack.step}` : ''
  const lines = [
    `=== Turn ${v.turn} — P${v.turnPlayer}'s turn — ${PHASE_LABEL[v.phase]}${step} — you are P${v.me} ===`,
    `Opponent P${opp}: deck ${v.fields[opp].deck.length}, hand ${v.fields[opp].handCount}, damage ${v.fields[opp].damageZone.length}/7, break ${v.fields[opp].breakZone.length}`,
    `  Forwards: ${v.fields[opp].forwards.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    `  Backups:  ${v.fields[opp].backups.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    `You P${v.me}: deck ${v.fields[v.me].deck.length}, damage ${v.fields[v.me].damageZone.length}/7, break ${v.fields[v.me].breakZone.length}`,
    `  Forwards: ${v.fields[v.me].forwards.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    `  Backups:  ${v.fields[v.me].backups.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    `  Hand (${v.hand.length}): ${v.hand.map((id) => `[${id}] ${name(v, id)}`).join('  ')}`,
  ]
  if (v.attack?.attackers.length) lines.push(`  Attacking: ${v.attack.attackers.map((id) => name(v, id)).join(' + ')}${v.attack.blocker !== null ? ` blocked by ${name(v, v.attack.blocker)}` : ''}`)
  if (v.result) lines.push(`*** GAME OVER: ${v.result.winner === null ? 'draw' : `P${v.result.winner} wins`} — ${v.result.reason}`)
  return lines.join('\n')
}

export function describeCommand(v: PlayerView, c: Command): string {
  switch (c.type) {
    case 'chooseFirst': return c.goFirst ? 'Take the first turn' : 'Let the opponent go first'
    case 'mulligan': return c.redraw ? 'Mulligan (redraw 5)' : 'Keep hand'
    case 'castCharacter':
    case 'castSummon': {
      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
      return `Cast ${name(v, c.card)} paying: ${pay.join(', ') || 'nothing'}`
    }
    case 'chooseTargets': return c.targets.length ? `Target ${c.targets.map((id) => name(v, id)).join(', ')}` : 'Choose no targets'
    // The printed WORDING, not an ordinal. "Choose mode 1" tells a player nothing about what mode 1 does,
    // and the engine already carries the labels on the pending precisely so a renderer need not guess — the
    // browser has read them since rung C1. Found by playing the hotseat: a modal ability offered
    // "Choose mode 1 + 2" with the effects nowhere on screen.
    case 'chooseMode': {
      if (!c.modes.length) return 'Choose no modes'
      const labels = v.pending?.kind === 'chooseMode' ? v.pending.labels : []
      return c.modes.map((i) => labels[i] ?? `mode ${i + 1}`).join(' + ')
    }
    case 'chooseFromDeck': {
      // A search PLAYS what it finds; a look ADDS it to hand. Which cards the indices name is
      // `pickedDeckCards`' rule, shared with the browser — both renderers got it wrong the same two ways.
      const field = v.pending?.kind === 'chooseFromDeck' && v.pending.to === 'field'
      if (!c.picks.length) return field ? 'Find nothing' : 'Take nothing'
      const named = pickedDeckCards(v, c.player, c.picks)
      const what = named ? named.map((id) => name(v, id)).join(', ') : `${c.picks.length} card(s)`
      return field ? `Play ${what} onto the field` : `Take ${what}`
    }
    case 'declareAttack': return `Attack with ${c.attackers.map((id) => name(v, id)).join(' + ')}`
    case 'declareBlock': return c.blocker === null ? 'No block' : `Block with ${name(v, c.blocker)}`
    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${name(v, a.target)}`).join(', ')}`
    case 'discardToHandSize': return `Discard ${c.cards.map((id) => name(v, id)).join(', ')}`
    case 'activateAbility': {
      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
      const cost = abilityCostOf(v, c.source, c.abilityId)
      // The EFFECT, not just the cost: a hotseat player has no more access to rules text than a browser one.
      const ability = abilityOf(v, c.source, c.abilityId)
      const does = ability ? describeAbilityEffect(ability) : null
      const clause = does === null ? `${cost} ability` : `${cost}: ${does}`
      return `Use ${name(v, c.source)}'s ${clause}${pay.length ? ` paying: ${pay.join(', ')}` : ''}`
    }
    case 'pass': return 'Pass'
    case 'concede': return 'Concede'
  }
}

/** One clause off the view's defs, or undefined when the card or the id is unknown. */
function abilityOf(v: PlayerView, source: number, abilityId: string): Ability | undefined {
  const def = v.defs[v.cards[source]?.code ?? '']
  return (def?.abilities ?? []).find((a) => a.id === abilityId)
}

/** The printed cost of one activated clause, for the command label. */
function abilityCostOf(v: PlayerView, source: number, abilityId: string): string {
  const def = v.defs[v.cards[source]?.code ?? '']
  const ability = (def?.abilities ?? []).find((a) => a.id === abilityId)
  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'ability'
}
