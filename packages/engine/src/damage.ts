import type { PlayerId } from './types.js'
import { opponentOf } from './types.js'
import type { DamageChange, DamageScope, Frame } from './abilities.js'
import type { CardId, DamageOccurrence, FieldCard, GameState, Pending } from './state.js'
import { defOf, findFieldCard, updatePlayer } from './state.js'
import type { DamageTraceStep, Event } from './events.js'
import { matchesDefFilter } from './filters.js'
import { staticApplies } from './layer.js'

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
  /** The amount marked after the replacement effects (rung V2-A2); 0 when not applied, or when reduced to 0. */
  readonly final: number
  /** The replacement steps applied, in order (rung V2-A2). */
  readonly trace: readonly DamageTraceStep[]
  /** One per dealer, each carrying `final`, for the dealt-damage triggers — never re-applied (a held First Strike batch).
   *  None when the final amount is 0: 0 damage is not damage (spec V2-D4, ruling 2021-08-19). */
  readonly occurrences: readonly DamageOccurrence[]
  readonly events: readonly Event[]
}

const NOT_APPLIED = { applied: false, final: 0, trace: [], occurrences: [], events: [] } as const

/**
 * One replacement effect waiting for a packet (rung V2-A2, plan A2-D3): a `damageReplacement` static of a card on the
 * field, its id `<card id>:<effect id>` — card ids on the field are public, so it names the same effect in every
 * determinised world — or a SHIELD on the damaged Forward (plan A2-D2), its id the shield's. `by` is the card whose
 * effect it is (for a shield, the card that granted it), for the trace and for the order prompt's wording.
 */
export interface Replacement { readonly id: string; readonly by: CardId; readonly change: DamageChange; readonly shield?: true }

/** Does the static's scope admit this packet? Relative to `controller`, the controller of `source`, which carries it. */
function scopeAdmits(state: GameState, source: CardId, controller: PlayerId, scope: DamageScope, packet: DamagePacket, targetController: PlayerId): boolean {
  if (scope.target === 'self') { if (packet.target !== source) return false }
  else {
    if (scope.target.controller === 'self' && targetController !== controller) return false
    if (scope.target.filter && !matchesDefFilter(defOf(state, packet.target), scope.target.filter)) return false
  }
  if (scope.byCause === 'ability' && packet.cause !== 'ability') return false
  if (scope.byController === 'opponent' && packet.causeController !== opponentOf(controller)) return false
  // Plan R8: EVERY dealer is a card of the static's controller matching the filter. A mixed-controller packet does not
  // arise in this pool (a party is one player's), so "every" and "any" agree on every packet the pool can build.
  const by = scope.bySource
  if (by && !packet.dealers.every((d) => d.sourceController === controller && matchesDefFilter(defOf(state, d.source), by.filter))) return false
  return true
}

/**
 * Every replacement effect that applies to `packet` (rung V2-A2, plan A2-D3), in the stable CANONICAL order — by the
 * card carrying it, then by id. Read from the cards on the FIELD only (§11.12.5.3: it must exist before the event),
 * each at most once per packet however many dealers the packet has (§11.12.5.5, plan R8). Empty when the target is not
 * a Forward on the field.
 */
export function replacementsFor(state: GameState, packet: DamagePacket): Replacement[] {
  const loc = findFieldCard(state, packet.target)
  if (!loc || loc.zone !== 'forwards') return []
  const out: Replacement[] = []
  for (const p of [0, 1] as const) {
    for (const c of [...state.players[p].forwards, ...state.players[p].backups]) {
      for (const a of defOf(state, c.id).abilities ?? []) {
        if (a.trigger.kind !== 'static' || a.trigger.effect.kind !== 'damageReplacement') continue
        const eff = a.trigger.effect
        if (!scopeAdmits(state, c.id, p, eff.affects, packet, loc.owner)) continue
        if (!staticApplies({ state, source: c.id, controller: p }, eff.when)) continue
        out.push({ id: `${c.id}:${eff.id}`, by: c.id, change: eff.change })
      }
    }
  }
  // A shield is a replacement of the damaged Forward's own (plan A2-D2): every damage to it is a candidate.
  for (const sh of loc.card.shields ?? []) out.push({ id: sh.id, by: sh.source, change: { reduce: sh.reduce }, shield: true })
  return out.sort((a, b) => a.by - b.by || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** What one order of replacements does to an amount (plan A2-D3): the final amount, the steps, the shields it uses up. */
export interface OrderOutcome { readonly final: number; readonly trace: readonly DamageTraceStep[]; readonly consumes: readonly string[] }

/**
 * §4.3 arithmetic (plan A2-D3, spec V2-D3): the replacements change a RUNNING amount in `order`, which may go negative
 * between steps and keeps its sign for the next change; the final amount below 0 is 0. `becomes: 0` sets it to 0, and
 * a later increase still applies to that 0 (plan Review Focus 1: Yuzuki first, then Wuk Lamat's +2000, is 2000).
 */
export function applyInOrder(amount: number, order: readonly Replacement[]): OrderOutcome {
  let v = amount
  const trace: DamageTraceStep[] = []
  const consumes: string[] = []
  for (const r of order) {
    // A shield replaces DAMAGE (plan R2): once the running amount is 0 or less there is no damage left for it to
    // replace (ruling 2021-08-19, "damage is not damage"), so it is not applied — and survives for the next packet.
    if (r.shield) {
      if (v <= 0) continue
      consumes.push(r.id)
    }
    const before = v
    v = 'add' in r.change ? v + r.change.add : 'reduce' in r.change ? v - r.change.reduce : 0
    trace.push({ by: r.by, before, after: v })
  }
  return { final: Math.max(0, v), trace, consumes }
}

/**
 * The §11.12.5.7 choice a packet owes, if any (rung V2-A2, plan A2-D4, R2, R6). When two or more replacements apply
 * and their orders do not all give the same `(final, consumed shield ids)`, the controller of the damaged Forward
 * chooses. `options` holds ONE order per distinct outcome — the first in permutation order, which begins with the
 * canonical order — each as replacement ids; `outcomes` is parallel to it. The notice of 2020-03-18 puts an increase
 * and "becomes 0" in the same step; who orders them is §11.12.5.7.
 */
export interface ReplacementChoice {
  readonly replacements: readonly Replacement[]
  readonly options: readonly (readonly string[])[]
  readonly outcomes: readonly { readonly final: number; readonly consumes: readonly string[] }[]
}

/** More replacements than this on one packet is 5040+ orders — far past anything the pool can build; refused loudly. */
const MAX_ORDERED_REPLACEMENTS = 6

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]))
}

/** Every distinct outcome of `replacements` on `amount`, each with its first order (plan A2-D4). */
function distinctOrders(amount: number, replacements: readonly Replacement[]): ReplacementChoice {
  if (replacements.length > MAX_ORDERED_REPLACEMENTS) throw new Error(`${replacements.length} replacement effects on one damage packet; at most ${MAX_ORDERED_REPLACEMENTS} can be ordered`)
  const options: string[][] = []
  const outcomes: { final: number; consumes: string[] }[] = []
  const seen = new Set<string>()
  for (const order of permutations(replacements)) {
    const o = applyInOrder(amount, order)
    const consumes = [...o.consumes].sort()
    const key = `${o.final}|${consumes.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push(order.map((r) => r.id))
    outcomes.push({ final: o.final, consumes })
  }
  return { replacements, options, outcomes }
}

/** The choice `packet` owes on `state`, or null when there is none — fewer than two replacements, or one outcome. */
export function replacementChoice(state: GameState, packet: DamagePacket): ReplacementChoice | null {
  if (packet.amount <= 0) return null
  const replacements = replacementsFor(state, packet)
  if (replacements.length < 2) return null
  const choice = distinctOrders(packet.amount, replacements)
  return choice.options.length > 1 ? choice : null
}

/**
 * The replacements in `order` (ids), or the canonical order when `order` is absent. An order must name exactly the
 * replacements that apply — the caller asked on this same state — and one is required when there is a choice.
 */
function ordered(state: GameState, packet: DamagePacket, order: readonly string[] | undefined): Replacement[] {
  const replacements = replacementsFor(state, packet)
  if (order === undefined) {
    if (replacementChoice(state, packet)) throw new Error(`the damage to ${packet.target} owes an order of its replacement effects (§11.12.5.7); none was given`)
    return replacements
  }
  const byId = new Map(replacements.map((r) => [r.id, r]))
  const out = order.map((id) => byId.get(id))
  if (out.length !== replacements.length || new Set(order).size !== order.length || out.some((r) => r === undefined)) {
    throw new Error(`order [${order.join(', ')}] is not an order of the replacement effects on ${packet.target}: [${replacements.map((r) => r.id).join(', ')}]`)
  }
  return out as Replacement[]
}

/**
 * The amount `applyDamagePacket` would mark, without marking it — the AI's price for damage (plan R9, spec V2-D8).
 * With an `order` it prices that order; without one it prices what the damaged Forward's controller would choose
 * (plan R6): the least damage, then the fewest shields used up — the canonical order when there is no choice.
 */
export function previewDamagePacket(state: GameState, packet: DamagePacket, order?: readonly string[]): { applied: boolean; final: number } {
  const loc = findFieldCard(state, packet.target)
  if (!loc || loc.zone !== 'forwards') return { applied: false, final: 0 }
  if (packet.amount <= 0) return { applied: true, final: 0 }
  if (order !== undefined) return { applied: true, final: applyInOrder(packet.amount, ordered(state, packet, order)).final }
  const choice = replacementChoice(state, packet)
  if (!choice) return { applied: true, final: applyInOrder(packet.amount, replacementsFor(state, packet)).final }
  return { applied: true, final: Math.min(...choice.outcomes.map((o) => o.final)) }
}

/**
 * The prompt a packet's choice raises (plan A2-D4, R3): owed by the controller of the damaged Forward — the affected
 * card's controller orders them (§11.12.5.7), whoever dealt the damage.
 */
export function replacementOrderPending(state: GameState, packet: DamagePacket, choice: ReplacementChoice, owner: 'battle' | 'frame'): Extract<Pending, { kind: 'chooseReplacementOrder' }> {
  const loc = findFieldCard(state, packet.target)
  if (!loc) throw new Error(`a replacement order for ${packet.target}, which is not on the field`)
  return {
    kind: 'chooseReplacementOrder', player: loc.owner, owner, target: packet.target, original: packet.amount,
    replacements: choice.replacements.map((r) => ({ id: r.id, by: r.by, change: r.change, ...(r.shield ? { shield: true as const } : {}) })),
    options: choice.options, outcomes: choice.outcomes,
  }
}

/**
 * The orders for a set of simultaneous packets (plan A2-D4, R1, R4): each packet that owes a choice takes the next of
 * `answers`, in packet order. Built on ONE state, before any packet lands, so an answer given for a prompt names the
 * same options when the packets are re-built from that state. `ask` is the first choice still unanswered, if any.
 */
export function packetOrders(state: GameState, packets: readonly DamagePacket[], answers: readonly number[]):
  { readonly orders: readonly (readonly string[] | undefined)[]; readonly used: number; readonly ask: { packet: DamagePacket; choice: ReplacementChoice } | null } {
  const orders: (readonly string[] | undefined)[] = []
  let used = 0
  for (const packet of packets) {
    const choice = replacementChoice(state, packet)
    if (!choice) { orders.push(undefined); continue }
    const answer = answers[used]
    const order = answer === undefined ? undefined : choice.options[answer]
    if (order === undefined) return { orders, used, ask: { packet, choice } }
    used++
    orders.push(order)
  }
  return { orders, used, ask: null }
}

/** Why an answer to a `chooseReplacementOrder` would be refused, or null — the exact test both owners' `apply` runs. */
export function replacementOrderCheck(state: GameState, player: PlayerId, order: number): string | null {
  if (state.result) return 'game is over'
  const pending = state.pending
  if (pending?.kind !== 'chooseReplacementOrder' || pending.player !== player) return 'no replacement order owed by this player'
  if (!Number.isInteger(order) || order < 0 || order >= pending.options.length) return `${order} is not one of the ${pending.options.length} orders`
  return null
}

/**
 * The index of the option the damaged Forward's controller prefers (plan R6): the least damage, then the fewest
 * shields used up, then the first listed. Greedy's answer and the preview's assumption — one rule, so they agree.
 */
export function preferredOrder(choice: Pick<ReplacementChoice, 'outcomes'>): number {
  let best = 0
  choice.outcomes.forEach((o, i) => {
    const b = choice.outcomes[best] as { final: number; consumes: readonly string[] }
    if (o.final < b.final || (o.final === b.final && o.consumes.length < b.consumes.length)) best = i
  })
  return best
}

/**
 * Mark a packet's damage on its target, and say so: one `battleDamage` (naming every dealer) or `abilityDamage`
 * event, and one `DamageOccurrence` per dealer for the dealt-damage triggers. The caller queues those — and runs
 * the §12.4.5 rule process — only once its whole simultaneous batch has landed (§10.1.4.2).
 *
 * Rung V2-A2: the replacement effects apply first (plan A2-D3), in `order` (replacement ids) — required when the packet
 * owes a choice (`replacementChoice`), the canonical order otherwise. A final amount of 0 is not damage (spec V2-D4, the
 * official ruling of 2021-08-19): nothing is marked, no damage event and no occurrence — so no dealt-damage trigger —
 * and a `damageReducedToZero` narrates it. A packet of 0 or less to begin with (no pool path builds one) emits nothing.
 *
 * MVP0-SIMPLIFICATION (§12.4.5 breaker attribution): the occurrences feed dealt-damage triggers only. Nothing records
 * which source broke a Forward by the rule process (`ZoneTransition.cause` is null for it); no pool card reads that,
 * so it is unobservable here. A real attribution ledger is backlog (plan R1).
 */
export function applyDamagePacket(state: GameState, packet: DamagePacket, order?: readonly string[]): DamageApplication {
  if (packet.dealers.length === 0) throw new Error(`a damage packet to ${packet.target} has no dealer`)
  if (packet.cause !== 'battle' && packet.dealers.length !== 1) throw new Error(`a ${packet.cause} damage packet has exactly one dealer, got ${packet.dealers.length}`)
  const loc = findFieldCard(state, packet.target)
  if (!loc || loc.zone !== 'forwards') return { state, ...NOT_APPLIED }
  if (packet.amount <= 0) return { state, applied: true, final: 0, trace: [], occurrences: [], events: [] }
  const { final, trace, consumes } = applyInOrder(packet.amount, ordered(state, packet, order))
  const dealers = packet.dealers.map((d) => d.source)
  // The shields this order used up are gone, whatever the final amount: they replaced the event (plan A2-D5).
  const spent = (c: FieldCard): FieldCard => {
    if (consumes.length === 0 || !c.shields) return c
    const left = c.shields.filter((sh) => !consumes.includes(sh.id))
    if (left.length > 0) return { ...c, shields: left }
    const rest: FieldCard = { ...c }
    delete rest.shields
    return rest
  }
  const mark = (amount: number): GameState => updatePlayer(state, loc.owner, (ps) => ({ ...ps, forwards: ps.forwards.map((c) => (c.id === packet.target ? { ...spent(c), damage: c.damage + amount } : c)) }))
  if (final <= 0) {
    return { state: consumes.length ? mark(0) : state, applied: true, final: 0, trace, occurrences: [], events: [{ type: 'damageReducedToZero', target: packet.target, dealers, original: packet.amount, trace }] }
  }
  const s = mark(final)
  const event: Event = packet.cause === 'battle'
    ? { type: 'battleDamage', target: packet.target, dealers, original: packet.amount, amount: final, trace }
    : { type: 'abilityDamage', source: (packet.dealers[0] as DamageDealer).source, target: packet.target, original: packet.amount, amount: final, trace }
  // `targetController` is the damaged Forward's side NOW: a held First Strike occurrence's target may be gone by the
  // time its trigger is placed (§15.2.3.3).
  const occurrences = packet.dealers.map((d): DamageOccurrence => ({ source: d.source, sourceController: d.sourceController, target: packet.target, victim: null, amount: final, targetController: loc.owner }))
  return { state: s, applied: true, final, trace, occurrences, events: [event] }
}

/** One replacement's change as the prompt and the log say it (plan A2-D7): "+2000", "−1000", "reduction to 0", "shield −2000". */
export function describeDamageChange(change: DamageChange, shield = false): string {
  const said = 'add' in change ? `+${change.add}` : 'reduce' in change ? `−${change.reduce}` : 'reduction to 0'
  return shield ? `shield ${said}` : said
}

/**
 * One option of a `chooseReplacementOrder`, worded for a button (plan A2-D7): "Yuzuki's reduction to 0, then Wuk
 * Lamat's +2000 → 2000". A shield the order leaves unused says so — which one survives is the difference. ONE
 * wording, so the browser and the terminal cannot describe the same option differently. `nameOf` names a card.
 */
export function describeReplacementOrder(pending: Extract<Pending, { kind: 'chooseReplacementOrder' }>, order: number, nameOf: (id: CardId) => string): string {
  const byId = new Map(pending.replacements.map((r) => [r.id, r]))
  const steps = (pending.options[order] ?? []).map((id) => {
    const r = byId.get(id)
    return r ? `${nameOf(r.by)}'s ${describeDamageChange(r.change, r.shield === true)}` : id
  })
  const outcome = pending.outcomes[order]
  const kept = pending.replacements.filter((r) => r.shield && !(outcome?.consumes ?? []).includes(r.id)).map((r) => `${nameOf(r.by)}'s shield`)
  return `${steps.join(', then ')} → ${outcome?.final ?? '?'}${kept.length ? ` (${kept.join(' and ')} kept)` : ''}`
}
