import type { PlayerId } from './types.js'
import type { Frame } from './abilities.js'
import type { CardId, DamageOccurrence, GameState } from './state.js'
import { defOf, findFieldCard, updatePlayer } from './state.js'
import type { DamageTraceStep, Event } from './events.js'

/**
 * Rung V2-A1 (spec V2-D1): every damage to a FORWARD — battle, ability, Summon, either First Strike batch — is one
 * `DamagePacket` applied at ONE point, so rung V2-A2's replacement effects (§11.12.5) have exactly one place to act.
 *
 * LAYERING — pure, and imports nothing from `rules.ts`, `resolve.ts` or `attack.ts`: both producers call in, and the
 * AI previews through it. Player damage is not a packet (spec V2-D1: none of the five V2 clauses touches it); it
 * stays `dealPlayerDamage`'s.
 */

/** What dealt the damage (spec V2-D6): Yuzuki's "by your opponent's abilities" is `ability`, never a Summon. */
export type DamageCause = 'battle' | 'summon' | 'ability'

/** One card dealing the packet, with its controller captured as the damage is dealt (the source may be about to leave). */
export interface DamageDealer { readonly source: CardId; readonly sourceController: PlayerId }

/**
 * One lot of damage to one Forward.
 *
 * `dealers` are the cards that can legally deal it (plan R2, §15.1.1.9.8: each member of a blocked party checks that
 * before the total is calculated) — every member, in this pool, since no card restricts it. `amount` is built from
 * them alone by the caller. A non-battle packet has exactly one dealer: an ability's damage is sourced to the card
 * whose ability it is (§15.1.1.9.10).
 */
export interface DamagePacket {
  readonly target: CardId
  readonly dealers: readonly DamageDealer[]
  readonly amount: number
  readonly cause: DamageCause
  /** The controller of what dealt it: the attacking or blocking side in battle, the frame's controller otherwise. */
  readonly causeController: PlayerId
  /** Dealt by an EX Burst (§11.10) — a Summon's or a Character's; `cause` still says which. */
  readonly exBurst?: true
}

/** A resolving frame's side of a packet (plan R5): what its damage counts as, and for whom. */
export interface DamageProvenance { readonly cause: 'summon' | 'ability'; readonly causeController: PlayerId; readonly exBurst?: true }

/**
 * What a frame's damage is (plan R5, spec V2-D6). A Summon's frames — cast (a `summon` stack item) or EX Burst — run
 * with the Summon CARD as their source (`cast.ts`), and a Summon is never on the field to trigger anything else, so
 * the source's printed type decides `summon` against `ability`. `Frame.origin === 'exBurst'` (set by
 * `applyChooseExBurst`) marks a burst of either kind. Takes only what it reads, so the AI can price a clause it has
 * no frame for yet.
 */
export function damageProvenance(state: GameState, frame: Pick<Frame, 'source' | 'controller' | 'origin'>): DamageProvenance {
  const cause = defOf(state, frame.source).type === 'summon' ? 'summon' : 'ability'
  return { cause, causeController: frame.controller, ...(frame.origin === 'exBurst' ? { exBurst: true as const } : {}) }
}

export interface DamageApplication {
  readonly state: GameState
  /** False when the target is no longer a Forward on the field: nothing marked, nothing emitted (plan R3). */
  readonly applied: boolean
  /** The amount marked — the packet's amount until rung V2-A2 adds replacement effects; 0 when not applied. */
  readonly final: number
  /** The replacement steps applied, in order. Always empty in rung V2-A1. */
  readonly trace: readonly DamageTraceStep[]
  /** One per dealer, each carrying `final`, for the dealt-damage triggers — never re-applied (a held First Strike batch). */
  readonly occurrences: readonly DamageOccurrence[]
  readonly events: readonly Event[]
}

const NOT_APPLIED = { applied: false, final: 0, trace: [], occurrences: [], events: [] } as const

/** The amount `applyDamagePacket` would mark, without marking it — the AI's price for damage (plan R9, spec V2-D8). */
export function previewDamagePacket(state: GameState, packet: DamagePacket): { applied: boolean; final: number } {
  const loc = findFieldCard(state, packet.target)
  if (!loc || loc.zone !== 'forwards') return { applied: false, final: 0 }
  return { applied: true, final: packet.amount }
}

/**
 * Mark a packet's damage on its target, and say so: one `battleDamage` (naming every dealer) or `abilityDamage`
 * event, and one `DamageOccurrence` per dealer for the dealt-damage triggers. The caller queues those — and runs
 * the §12.4.5 rule process — only once its whole simultaneous batch has landed (§10.1.4.2).
 *
 * MVP0-SIMPLIFICATION (§12.4.5 breaker attribution): the occurrences feed dealt-damage triggers only. Nothing records
 * which source broke a Forward by the rule process (`ZoneTransition.cause` is null for it); no pool card reads that,
 * so it is unobservable here. A real attribution ledger is backlog (plan R1).
 */
export function applyDamagePacket(state: GameState, packet: DamagePacket): DamageApplication {
  if (packet.dealers.length === 0) throw new Error(`a damage packet to ${packet.target} has no dealer`)
  if (packet.cause !== 'battle' && packet.dealers.length !== 1) throw new Error(`a ${packet.cause} damage packet has exactly one dealer, got ${packet.dealers.length}`)
  const { applied, final } = previewDamagePacket(state, packet)
  const loc = findFieldCard(state, packet.target)
  if (!applied || !loc) return { state, ...NOT_APPLIED }
  const trace: DamageTraceStep[] = []
  const s = updatePlayer(state, loc.owner, (ps) => ({ ...ps, forwards: ps.forwards.map((c) => (c.id === packet.target ? { ...c, damage: c.damage + final } : c)) }))
  const event: Event = packet.cause === 'battle'
    ? { type: 'battleDamage', target: packet.target, dealers: packet.dealers.map((d) => d.source), original: packet.amount, amount: final, trace }
    : { type: 'abilityDamage', source: (packet.dealers[0] as DamageDealer).source, target: packet.target, original: packet.amount, amount: final, trace }
  // `targetController` is the damaged Forward's side NOW: a held First Strike occurrence's target may be gone by the
  // time its trigger is placed (§15.2.3.3).
  const occurrences = packet.dealers.map((d): DamageOccurrence => ({ source: d.source, sourceController: d.sourceController, target: packet.target, victim: null, amount: final, targetController: loc.owner }))
  return { state: s, applied: true, final, trace, occurrences, events: [event] }
}
