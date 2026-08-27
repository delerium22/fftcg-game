import type { CardId, Command, FieldCard, PlayerView } from '@fftcg/engine'
import { describeAbilityCost } from '@fftcg/engine'

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
    case 'chooseMode': return c.modes.length ? `Choose mode ${c.modes.map((i) => i + 1).join(' + ')}` : 'Choose no modes'
    case 'chooseFromDeck': {
      if (!c.picks.length) return 'Take nothing'
      const exposed = v.fields[v.me].deck
      const named = c.picks.map((i) => exposed[i]?.card).filter((id): id is CardId => id !== null && id !== undefined)
      return named.length === c.picks.length ? `Take ${named.map((id) => name(v, id)).join(', ')}` : `Take ${c.picks.length} card(s)`
    }
    case 'declareAttack': return `Attack with ${c.attackers.map((id) => name(v, id)).join(' + ')}`
    case 'declareBlock': return c.blocker === null ? 'No block' : `Block with ${name(v, c.blocker)}`
    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${name(v, a.target)}`).join(', ')}`
    case 'discardToHandSize': return `Discard ${c.cards.map((id) => name(v, id)).join(', ')}`
    case 'activateAbility': {
      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
      const cost = abilityCostOf(v, c.source, c.abilityId)
      return `Use ${name(v, c.source)}'s ${cost} ability${pay.length ? ` paying: ${pay.join(', ')}` : ''}`
    }
    case 'pass': return 'Pass'
    case 'concede': return 'Concede'
  }
}

/** The printed cost of one activated clause, for the command label. */
function abilityCostOf(v: PlayerView, source: number, abilityId: string): string {
  const def = v.defs[v.cards[source]?.code ?? '']
  const ability = (def?.abilities ?? []).find((a) => a.id === abilityId)
  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'ability'
}
