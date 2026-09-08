import { attackCheck, isLegal, type CardId, type Command, type GameState, type PlayerView } from '@fftcg/engine'
import { describeChoice, stateShim } from './commands.js'
import type { Choice } from './types.js'

/**
 * The set picker's model (rung J7-D3/D4): pure functions over the position and the cards chosen so far, for
 * every decision whose answer is a SET of cards — an attack party, "choose up to N", a hand-size discard, the
 * excess-Backup choice. Mirrors payment.ts, with one difference the whole rung turns on: legality here is the
 * ENGINE'S PREDICATE (`isLegal`, `attackCheck`), not membership in `legalCommands`' list, which above the cap
 * is a sample (J7-D1/D2). So the picker may build a set the list never spelled out, and Confirm submits it.
 */

export type SetKind = 'attackers' | 'targets' | 'discards' | 'backups'
export interface Selection { readonly kind: SetKind; readonly chosen: readonly CardId[] }

/** Which set-shaped decision, if any, the position is asking the viewer for. */
export function setKindFor(v: PlayerView): SetKind | null {
  if (v.result) return null
  const p = v.pending
  if (p) {
    if (p.player !== v.me) return null
    if (p.kind === 'chooseTargets') return p.max > 1 ? 'targets' : null
    if (p.kind === 'discardToHandSize') return p.count > 1 ? 'discards' : null
    if (p.kind === 'breakExcessBackups') return p.count > 1 ? 'backups' : null
    return null
  }
  if (v.phase === 'attack' && v.attack?.step === 'declaration' && v.priority === v.me && v.turnPlayer === v.me) {
    return eligibleAttackers(stateShim(v), v).length > 1 ? 'attackers' : null
  }
  return null
}

function eligibleAttackers(shim: GameState, v: PlayerView): CardId[] {
  return v.fields[v.me].forwards.map((c) => c.id).filter((id) => attackCheck(shim, v.me, [id]) === null)
}

/** Every card the picker may ever offer for this kind, in board order. */
export function candidatesFor(v: PlayerView, kind: SetKind): CardId[] {
  const p = v.pending
  switch (kind) {
    case 'targets': return p?.kind === 'chooseTargets' ? [...p.candidates] : []
    case 'discards': return [...v.hand]
    case 'backups': return v.fields[v.me].backups.map((c) => c.id)
    case 'attackers': return eligibleAttackers(stateShim(v), v)
  }
}

/** The bounds the kind carries: how many must and may be chosen. */
export function boundsFor(v: PlayerView, kind: SetKind): { min: number; max: number } {
  const p = v.pending
  switch (kind) {
    case 'targets': return p?.kind === 'chooseTargets' ? { min: p.min, max: p.max } : { min: 0, max: 0 }
    case 'discards': return p?.kind === 'discardToHandSize' ? { min: p.count, max: p.count } : { min: 0, max: 0 }
    case 'backups': return p?.kind === 'breakExcessBackups' ? { min: p.count, max: p.count } : { min: 0, max: 0 }
    case 'attackers': return { min: 1, max: candidatesFor(v, kind).length }
  }
}

/** The whole-set command the selection stands for. */
export function commandFor(v: PlayerView, sel: Selection): Command {
  const cards = [...sel.chosen].sort((a, b) => a - b)
  switch (sel.kind) {
    case 'attackers': return { type: 'declareAttack', player: v.me, attackers: cards }
    case 'targets': return { type: 'chooseTargets', player: v.me, targets: cards }
    case 'discards': return { type: 'discardToHandSize', player: v.me, cards }
    case 'backups': return { type: 'breakExcessBackups', player: v.me, cards }
  }
}

/**
 * May `id` be added? A candidate not yet chosen, within `max`, and — for a party — still legal with it (a
 * party must share an element, §10.1.2.1, which is a property of the partial set too). For the pendings, any
 * subset of the candidates within the bounds can be completed, so the size is the whole test.
 */
export function extendableWith(v: PlayerView, sel: Selection, id: CardId): boolean {
  if (sel.chosen.includes(id)) return false
  if (!candidatesFor(v, sel.kind).includes(id)) return false
  if (sel.chosen.length >= boundsFor(v, sel.kind).max) return false
  if (sel.kind === 'attackers') return attackCheck(stateShim(v), v.me, [...sel.chosen, id]) === null
  return true
}

export function toggled(sel: Selection, id: CardId): Selection {
  return sel.chosen.includes(id) ? { ...sel, chosen: sel.chosen.filter((c) => c !== id) } : { ...sel, chosen: [...sel.chosen, id] }
}

/** Why Confirm is refused, or null when the set is a legal answer — the engine's own word (J7-D1). */
export function refusal(v: PlayerView, sel: Selection): string | null {
  const { min } = boundsFor(v, sel.kind)
  if (sel.chosen.length < min) return `choose ${min - sel.chosen.length} more`
  return isLegal(stateShim(v), commandFor(v, sel))
}

/** The Choice Confirm submits: the whole-set command with its ordinary label, anchored on the first card. */
export function completedChoice(v: PlayerView, sel: Selection): Choice | null {
  if (refusal(v, sel) !== null) return null
  const command = commandFor(v, sel)
  return { command, label: describeChoice(v, command), card: sel.chosen[0] ?? null }
}

/** The tray's live text: what is being built and how far along it is. */
export function selectionText(v: PlayerView, sel: Selection, name: (id: CardId) => string): string {
  const { min, max } = boundsFor(v, sel.kind)
  const verb = sel.kind === 'attackers' ? 'Attack with' : sel.kind === 'targets' ? 'Choose' : sel.kind === 'discards' ? 'Discard' : 'Put into the Break Zone'
  const names = sel.chosen.length ? sel.chosen.map(name).join(', ') : 'nothing yet'
  const need = min === max ? `${sel.chosen.length} of ${max} chosen` : `${sel.chosen.length} chosen (${min}–${max})`
  return `${verb}: ${names} — ${need}`
}
