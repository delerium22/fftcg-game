import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  actingPlayer, actionMenu, apply, canAffordCast, createGame, defOf, forcedDecision, isResponseWindow, legalCommands, viewFor,
  type AbilityTrigger, type CardId, type CardType, type Command, type Event, type FieldCard, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView, type ZoneTransitionReason, isLegal, legalCommandsWithMeta, observesType } from '@fftcg/engine'
import type { Agent } from '@fftcg/ai'
import { CARD_DEFS, DECK_CHOICES, DEFAULT_DECKS, deckLists, type DeckPair } from '../deck.js'
import { ATTACK_STEP_LABEL, bareName, buildChoiceSet, capitalise, describeChoice, paymentAlternatives, describeResult, describeTriggerCause, ownedCard, preferredChoices, qualifiedName, type TriggerCause } from './commands.js'
import { SearchCoordinator, type SearchCoordinatorOptions, type SearchRequestHandlers } from './search/coordinator.js'
import { AI, HUMAN, type Choice, type Control, type GameApi, type LogLine } from './types.js'

/** Spec B7: the agent decides in ~0.27 ms, far too fast to watch — one move per this many ms instead. */
export const AI_STEP_MS = 600

/**
 * Rung F4: the search's wall-clock box, and the floor below which the clock cannot stop it.
 *
 * `AI_STEP_MS` paces DELIVERY — a result that arrives early is held until the beat — and cannot do this job,
 * because it does not start until there is a result to hold. This bounds the search itself.
 *
 * 500 ms, measured rather than chosen: over 60 mirrored seed pairs against greedy, 58 of 60 produced the
 * IDENTICAL result boxed and unboxed (the two that differed went one way each), the mean paired difference was
 * 0.0000 points per game with a 95 % interval of [-2.5, +2.5], and mean decision time fell 243.9 -> 206.3 ms.
 * It is very nearly free because at 200 iterations most decisions already finish well inside it; what it
 * removes is the tail.
 *
 * THE FLOOR IS 64, AND 8 WAS DANGEROUS. The floor is what a slow machine actually plays, so its strength is
 * the strength of the opponent on that machine. Measured against greedy over mirrored seed pairs:
 *
 *      ismcts:8    12.5 %   <- what this shipped as, and it loses seven games in eight
 *      ismcts:16   33.3 %
 *      ismcts:32   63.3 %
 *      ismcts:64   71.7 %   CI [63.3, 80.0]
 *      ismcts:200  75.0 %   CI [66.7, 82.5]  (unboxed)
 *
 * WHY 8 was that bad, and what changed since: with eight or more root actions the first eight iterations
 * expand eight DIFFERENT actions at one visit each, and `rankRootEdges` used to tie on visits and fall
 * through to the key comparison, discarding every rollout reward — the answer was the alphabetically first
 * action of a random sample. **Rung F5 fixed that cause**: equally-visited edges now break on the better mean,
 * and the same 8-iteration agent measures 50.8 % rather than 12.5 %.
 *
 * The floor stays at 64 regardless. The numbers above were taken BEFORE F5, so they no longer describe what a
 * slow machine plays, and lowering the floor on the strength of that is a decision that needs its own
 * measurement — which is exactly the mistake that shipped the floor of 8.
 *
 * 64 is indistinguishable from the full 200 (the intervals overlap heavily) and costs ~77 ms of the 500 ms
 * box, so on normal hardware the clock stops the search long before the floor is relevant. On a slow machine
 * the floor wins and the box bounds less — which is the correct way round, because an opponent that answers
 * quickly and badly is worse than one that answers slowly and well.
 *
 * NOT a hard bound on how long a player waits: the worker handles messages serially, so a superseded search
 * still runs to completion before the next one starts. Bounding that needs the search chunked across turns of
 * the event loop, which this rung does not do.
 */
export const SEARCH_BUDGET = { ms: 500, minIterations: 64 } as const

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
}


const who = (v: PlayerView, p: PlayerId): string => (p === v.me ? 'You' : 'The AI')
const whoDoes = (v: PlayerView, p: PlayerId, mine: string, theirs: string): string => (p === v.me ? mine : theirs)
/** A field card's status as the view shows it (null when it is not on the field). */
const fieldStatus = (v: PlayerView, id: CardId): FieldCard['status'] | null => ([0, 1] as const).flatMap((p) => [...v.fields[p].forwards, ...v.fields[p].backups]).find((c) => c.id === id)?.status ?? null

const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
const FLAG_LABEL: Record<FieldFlag, string> = {
  cannotBeBroken: 'cannot be broken this turn',
  cannotBeReturnedByOpponent: "cannot be returned to its owner's hand by the opponent this turn",
  // Rung V1-A3: only Charlotte's continuous static carries it today, and a static emits no `flagGranted`; worded for the
  // day an effect grants it until the end of the turn.
  cannotUseActionAbilities: 'cannot use action abilities this turn',
}

/**
 * The printed wording of the clause that is resolving, quoted from the AST on `CardDef` (spec C1-1). Printed
 * text is multi-line — a modal clause prints one line per mode — and a log line is one line, so runs of
 * whitespace collapse. Nothing else about the wording is touched: reviewers check the AST against THIS.
 */
function abilityText(v: PlayerView, card: number, abilityId: string): string | null {
  const code = v.cards[card]?.code
  const def = code === undefined ? undefined : v.defs[code]
  const text = def?.abilities?.find((a) => a.id === abilityId)?.text
  return text === undefined ? null : text.replace(/\s+/g, ' ').trim()
}

/**
 * One log line per engine event, named from the HUMAN's *post-apply* view — by the time an event is narrated the
 * card it names has moved somewhere public (field, damage zone, break zone), so nothing here can name a card the
 * human may not see. `null` drops events the move line above them already states (`cast`, `attackDeclared`, the
 * CP that paid for them), keeping the log a narrative rather than a trace.
 *
 * `cause` is what fired an `abilityTriggered` (spec C2-5) — `eventLines` supplies it; it is ignored everywhere
 * else. Callers narrating a single event out of context can leave it off.
 */
export function describeEvent(v: PlayerView, e: Event, cause: TriggerCause | null = null): LogLine | null {
  switch (e.type) {
    case 'firstPlayerChosen': return { kind: 'phase', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} the first turn` }
    case 'mulligan': return { kind: 'event', text: `${who(v, e.player)} ${whoDoes(v, e.player, e.redraw ? 'mulligan' : 'keep your hand', e.redraw ? 'mulligans' : 'keeps its hand')}` }
    case 'turnStarted': return { kind: 'phase', text: `Turn ${e.turn} — ${whoDoes(v, e.player, 'your turn', "the AI's turn")}` }
    case 'phaseStarted': return { kind: 'phase', text: `${PHASE_LABEL[e.phase] ?? e.phase}${e.step ? ` — ${ATTACK_STEP_LABEL[e.step] ?? e.step}` : ''}` }
    case 'drew': return { kind: 'event', text: `${who(v, e.player)} draw${e.player === v.me ? '' : 's'} ${e.count} card${e.count === 1 ? '' : 's'}` }
    // A CP discard is already implied by the cast line, and a COST discard by the "activates" line — neither
    // needs its own entry. Only the hand-limit discard is a thing the player did not otherwise see.
    // Rung V1-A2: an effect's discard is what the clause DID, so it is narrated like the other effects.
    case 'discarded':
      return e.reason === 'handSize'
        ? { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${qualifiedName(v, e.card)} to the hand limit` }
        : e.reason === 'ability' ? { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${qualifiedName(v, e.card)}` }
        : null
    // B-A6 + C1-9: coverage is per CLAUSE. `clauses` counts the ones still missing on a card that DOES have an
    // implemented clause; its absence means the whole text box is unimplemented and the card played as vanilla.
    case 'unimplementedAbility': return e.clauses === undefined
      ? { kind: 'warning', text: `${qualifiedName(v, e.card)} (${e.code}) has abilities that are not implemented yet — played as vanilla` }
      : { kind: 'warning', text: `${qualifiedName(v, e.card)} (${e.code}) has ${e.clauses} more ability clause${e.clauses === 1 ? '' : 's'} that ${e.clauses === 1 ? 'is' : 'are'} not implemented yet` }
    // These three name a subject that has already LEFT the table — the damage zone, the removed pile — so
    // `name` cannot qualify it and the sentence has to. The event's own `player` is the authority; a lookup
    // would be guessing about a card that is no longer anywhere to look (Codex MAJOR).
    // G3. These replace the `exBurstSkipped` warning, which was the honest report that a rule was NOT applied.
    // They are plain events, not warnings: nothing is wrong now, and a warning that cries wolf is worse than
    // no warning — which is the argument `types.ts` makes about these very cards.
    //
    // `ownedCard` for the same reason the three above it use it: the subject is in the damage zone, so `name`
    // cannot qualify it and the sentence has to.
    case 'exBurstOffered':
      return { kind: 'event', text: `${capitalise(ownedCard(v, e.player, e.card))} has EX Burst — ${who(v, e.player)} may use it` }
    case 'exBurstUsed':
      return { kind: 'event', text: `${who(v, e.player)} use${e.player === v.me ? '' : 's'} the EX Burst on ${ownedCard(v, e.player, e.card)}` }
    case 'exBurstDeclined':
      return { kind: 'event', text: `${who(v, e.player)} decline${e.player === v.me ? '' : 's'} the EX Burst on ${ownedCard(v, e.player, e.card)}` }
    case 'battleDamage': return { kind: 'event', text: `${qualifiedName(v, e.source)} deals ${e.amount} damage to ${qualifiedName(v, e.target)}` }
    case 'playerDamaged': return { kind: 'event', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} 1 damage` }
    case 'broken': return { kind: 'event', text: `${qualifiedName(v, e.card)} is broken` }
    case 'putIntoBreakZone': return { kind: 'event', text: `${qualifiedName(v, e.card)} is put into the Break Zone (${BREAK_ZONE_WHY[e.reason]})` }
    // --- ability resolution (rung C1). The choice itself is already a move line — the human's from `choose`,
    // the AI's from `stepAi` — so these narrate what triggered and what it DID, closing the loop between the
    // printed text box and the board state the player is looking at.
    // C2: an OBSERVER trigger fires because of something that happened to a DIFFERENT card, so the cause goes
    // in front of the printed text. "Lightning's ability triggers — the AI's Prishe was broken" is the only
    // thing tying the prompt that follows to the board; and for a clause with no prompt at all (Luso's "break
    // it") the log is the ONLY evidence the trigger happened.
    case 'abilityTriggered': {
      const text = abilityText(v, e.card, e.abilityId)
      const why = cause ? ` — ${describeTriggerCause(v, cause)}` : ''
      // Rung V1-D: a reflexive clause has no trigger event to name; it fired because its own card's effect was done.
      const reflexive = triggerOf(v, e.card, e.abilityId)?.kind === 'reflexive' ? ' (when you do so)' : ''
      return { kind: 'event', text: `${qualifiedName(v, e.card)}'s ability triggers${reflexive}${why}${text ? `: "${text}"` : ''}` }
    }
    // C3: ACTIVATED, not triggered. The distinction is the whole of what this rung added for the player —
    // "triggers" would report a move they deliberately made as something that merely happened to them.
    case 'abilityActivated': {
      const text = abilityText(v, e.card, e.abilityId)
      // `bareName`, because the sentence already opens with the possessive — `name` would produce
      // "Your your Billy Bob activates" whenever the AI held a twin in play (Codex MINOR, shipped in the
      // commit before this one). Same reason `describeTriggerCause` has always used the bare name.
      return { kind: 'event', text: `${capitalise(ownedCard(v, e.player, e.card))} activates${text ? `: "${text}"` : ''}` }
    }
    case 'paidToBreakZone': return { kind: 'event', text: `${qualifiedName(v, e.card)} is put into the Break Zone to pay for it` }
    // The sibling cost above has said so since C3; without this the card simply vanishes from the Break Zone
    // with nothing in the log, which is the one thing the amber warnings exist to prevent elsewhere.
    case 'removedFromGame': return { kind: 'event', text: `${capitalise(ownedCard(v, e.player, e.card))} is removed from the game to pay for it` }
    // C9. A look and a reveal differ only in the verb; WHICH cards get named is decided by the view, not by
    // the audience, so this one line is safe for both. The AI's private look reaches the human as a count.
    case 'deckExposed': {
      const whose = whoDoes(v, e.player, 'your', 'its')
      // A search exposes the WHOLE deck. Calling that "the top 37 cards" would be true and useless — and
      // naming all 37 in the log would bury the move that matters, so a search says only that it happened.
      if (e.scope === 'deck') {
        return { kind: 'event', text: `${who(v, e.player)} search${e.player === v.me ? '' : 'es'} ${whose} deck` }
      }
      const verb = e.audience === 'all' ? whoDoes(v, e.player, 'reveal', 'reveals') : whoDoes(v, e.player, 'look at', 'looks at')
      const named = e.cards.filter((id) => v.cards[id] !== undefined)
      const shown = named.length === e.cards.length && named.length > 0 ? `: ${named.map((id) => qualifiedName(v, id)).join(', ')}` : ''
      return { kind: 'event', text: `${who(v, e.player)} ${verb} the top ${e.count} card${e.count === 1 ? '' : 's'} of ${whose} deck${shown}` }
    }
    // The card a search found is public the moment it lands, so this one always names it — unlike
    // `addedToHand`, whose card may be one this seat never saw.
    case 'playedFromDeck':
      // Bare: the sentence already says whose it is twice ("The AI plays … from its deck"), and with a twin on
      // the other side `qualifiedName` made it "The AI plays the AI's Luso onto the field" (found by playing).
      return { kind: 'event', text: `${who(v, e.player)} play${e.player === v.me ? '' : 's'} ${bareName(v, e.card)} onto the field from ${whoDoes(v, e.player, 'your', 'its')} deck` }
    // Rung V1-A2: the same, from the hand — public the moment it lands, so it is named.
    case 'playedFromHand':
      return { kind: 'event', text: `${who(v, e.player)} play${e.player === v.me ? '' : 's'} ${bareName(v, e.card)} onto the field from ${whoDoes(v, e.player, 'your', 'its')} hand` }
    // The other half: without this a revealed card is added to a hand with nothing in the log saying so, and
    // for the no-eligible path there is no board change at all to infer it from.
    case 'addedToHand': {
      const what = v.cards[e.card] !== undefined ? qualifiedName(v, e.card) : 'a card'
      return { kind: 'event', text: `${who(v, e.player)} add${e.player === v.me ? '' : 's'} ${what} to ${whoDoes(v, e.player, 'your', 'its')} hand` }
    }
    case 'abilityNoLegalTarget': return { kind: 'event', text: `${qualifiedName(v, e.card)}'s ability finds no legal target — nothing happens` }
    // Rung V1-D (R4): an item removed from the stack unresolved. The §11.8.4 and §11.11.2 cases were silent here before;
    // a conditional auto-ability's failed re-check (§11.11.3) has no other line at all.
    case 'stackCancelled': {
      const what = e.item.kind === 'summon' ? qualifiedName(v, e.item.card) : `${qualifiedName(v, e.item.source)}'s ability`
      return { kind: 'event', text: `${what} is removed from the stack — ${STACK_CANCELLED_WHY[e.reason]}` }
    }
    case 'dulled': return { kind: 'event', text: `${qualifiedName(v, e.card)} is dulled` }
    case 'activatedByAbility': return { kind: 'event', text: `${qualifiedName(v, e.card)} is activated` }
    // Rung J8 (§15.2.8): the Limit Break cost, and the return to the LB deck.
    case 'lbFlipped': return { kind: 'event', text: `${who(v, e.player)} turn${e.player === v.me ? '' : 's'} ${e.cards.map((id) => qualifiedName(v, id)).join(' and ')} face up (Limit Break cost)` }
    case 'lbReturned': return { kind: 'event', text: `${qualifiedName(v, e.card)} goes back to ${whoDoes(v, e.player, 'your', "the AI's")} LB deck face up` }
    case 'frozen': return { kind: 'event', text: `${qualifiedName(v, e.card)} is frozen — it will not activate next turn` }
    case 'thawed': return { kind: 'event', text: `${qualifiedName(v, e.card)} ${fieldStatus(v, e.card) === 'dull' ? 'stays dull' : 'is no longer frozen'} — it was frozen` }
    case 'abilityDamage': return { kind: 'event', text: `${qualifiedName(v, e.source)} deals ${e.amount} damage to ${qualifiedName(v, e.target)}` }
    case 'powerModified': return { kind: 'event', text: `${qualifiedName(v, e.card)} gets ${e.amount >= 0 ? '+' : ''}${e.amount} power until the end of the turn` }
    case 'keywordGranted': return { kind: 'event', text: `${qualifiedName(v, e.card)} gains ${KEYWORD_LABEL[e.keyword]} until the end of the turn` }
    case 'flagGranted': return { kind: 'event', text: `${qualifiedName(v, e.card)} ${FLAG_LABEL[e.flag]}` }
    case 'returnedToHand': return { kind: 'event', text: `${qualifiedName(v, e.card)} returns to ${whoDoes(v, e.player, 'your hand', "the AI's hand")}` }
    case 'brokenByAbility': return { kind: 'event', text: `${qualifiedName(v, e.card)} is broken by ${qualifiedName(v, e.source)}` }
    case 'breakPrevented': return { kind: 'event', text: `${qualifiedName(v, e.card)} survives — it ${FLAG_LABEL[e.flag]}` }
    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'}. ${describeResult(v.me, e.result)}` }
    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
    default: return null
  }
}

/** A card's printed TYPE from the view, for events that carry only its id. */
function defTypeOf(v: PlayerView, card: CardId): CardType | null {
  const code = v.cards[card]?.code
  return (code === undefined ? undefined : v.defs[code]?.type) ?? null
}

/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
  const code = v.cards[card]?.code
  const def = code === undefined ? undefined : v.defs[code]
  return def?.abilities?.find((a) => a.id === abilityId)?.trigger ?? null
}

/**
 * §7.10 puts a broken card in its OWNER's Break Zone, which is where narration finds it once it has left the
 * field. Owner and controller coincide for this pool — nothing in it changes control (rung C5) — so this is
 * the controller the clause's `whose` is measured against.
 */
function holderOf(v: PlayerView, id: CardId): PlayerId {
  for (const p of [0, 1] as const) if (v.fields[p].breakZone.includes(id)) return p
  return v.cards[id]?.owner ?? v.me
}

interface Hit { readonly source: CardId; readonly target: CardId; readonly amount: number; used: boolean }
interface PlayerHit { readonly victim: PlayerId; used: boolean }
interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; readonly reason: ZoneTransitionReason; used: boolean }
interface EnterHit { readonly card: CardId; readonly controller: PlayerId; readonly type: CardType; used: boolean }

/**
 * Pair one `abilityTriggered` with the event that fired it, consuming the candidate so the NEXT trigger of the
 * same clause gets the next one (CR §11.8.6 / spec C2-A3: one Lightning watching two simultaneous breaks
 * triggers twice, and the two lines must not both name the same Forward).
 *
 * `dealtDamage` is exact by construction: `enqueueDamageTriggers` hangs the clause off the DAMAGE SOURCE, so
 * the watcher id IS the source to match on. `observesZoneChange` is matched on `whose` relative to the frame's
 * own controller (`e.player`), never the turn player — spec C2-10, so the clause means the same from either
 * seat. Anything unmatched returns null and the line simply loses its cause clause rather than gaining a
 * wrong one.
 */
function causeOf(
  v: PlayerView, e: Extract<Event, { type: 'abilityTriggered' }>,
  hits: Hit[], playerHits: PlayerHit[], zoneHits: ZoneHit[], enterHits: EnterHit[],
): TriggerCause | null {
  const trigger = triggerOf(v, e.card, e.abilityId)
  if (!trigger) return null
  if (trigger.kind === 'dealtDamage') {
    if (trigger.to === 'player') {
      const hit = playerHits.find((h) => !h.used)
      if (!hit) return null
      hit.used = true
      return { kind: 'damage', source: e.card, target: null, victim: hit.victim, amount: 1 }
    }
    const hit = hits.find((h) => !h.used && h.source === e.card)
    if (!hit) return null
    hit.used = true
    return { kind: 'damage', source: hit.source, target: hit.target, victim: null, amount: hit.amount }
  }
  if (trigger.kind === 'observesZoneChange') {
    const wants = (controller: PlayerId): boolean =>
      trigger.whose === 'any' || (trigger.whose === 'self') === (controller === e.player)
    const hit = zoneHits.find((h) => !h.used && wants(h.controller))
    if (!hit) return null
    hit.used = true
    return { kind: 'zoneChange', card: hit.card, controller: hit.controller, reason: hit.reason }
  }
  if (trigger.kind === 'observesEnterField') {
    // The mirror of the branch above, and it has to exist for the same reason C2 wrote that one: the cause is
    // the only thing tying "Hugh Yurg's ability triggers" to the card that just arrived. C8 shipped the
    // narration for this cause and the `TriggerCause` variant, but not the reconstruction that produces one —
    // so the ordinary single-watcher line came out bare, while a second watcher (whose frame survived in the
    // queue across a prompt) got its cause from the other route. Two paths, disagreeing.
    const wants = (controller: PlayerId): boolean =>
      trigger.whose === 'any' || (trigger.whose === 'self') === (controller === e.player)
    const hit = enterHits.find((h) => !h.used && observesType(trigger.of, h.type) && wants(h.controller))
    if (!hit) return null
    hit.used = true
    return { kind: 'enteredField', card: hit.card, controller: hit.controller }
  }
  return null   // enterField/summonResolve are about the source itself — there is nothing to explain
}

/**
 * Narrate one command's events, saying what each triggered clause was reacting to (spec C2-5).
 *
 * `queued` is the agenda queue as it stood BEFORE the command, and it is the exact answer wherever it reaches:
 * those frames carry their own `triggerEvent`, `drainResolution` starts them FIFO, and starting a frame is what
 * emits `abilityTriggered` — so the n-th trigger of the batch is `queued[n]`. That is what rescues a trigger
 * whose cause happened in an EARLIER batch: a second Lightning occurrence sits in the queue across the prompt
 * the first one raised, and by the time it starts, the break that fired it is long gone from the event stream.
 *
 * ONE emitter breaks that rule and is guarded below: C11's `observesChosen` clause is applied inline and
 * never becomes a frame, so its `abilityTriggered` must not consume a slot.
 *
 * A frame both queued and drained inside THIS batch is in no queue anyone can see, so its cause is
 * reconstructed from the events instead — `causeOf`. That is the common case (Luso's "break it" raises no
 * prompt at all) and it is sound because the engine pushes a damage or break event before the trigger that
 * event queues, transition-major (spec C2-11). Both routes are guarded: an unmatched trigger loses its cause
 * clause rather than gaining a wrong one.
 */
export function eventLines(v: PlayerView, events: readonly Event[], queued: readonly Frame[] = []): LogLine[] {
  const hits: Hit[] = []
  const playerHits: PlayerHit[] = []
  const zoneHits: ZoneHit[] = []
  const enterHits: EnterHit[] = []
  const lines: LogLine[] = []
  let started = 0
  for (const e of events) {
    switch (e.type) {
      // Combat and ability damage alike — the printed text says "deals damage" (spec C2-7).
      case 'battleDamage':
      case 'abilityDamage': hits.push({ source: e.source, target: e.target, amount: e.amount, used: false }); break
      // `playerDamaged.card` is the card TAKEN as damage, not the dealer; the dealer is the watcher itself.
      case 'playerDamaged': playerHits.push({ victim: e.player, used: false }); break
      // A card ARRIVING (spec C8). `cast` was the only producer until C9's search; the comment here said a
      // future put-into-play path would have to add its own, and this is it. Without it, Hugh Yurg finding a
      // cost-1 Forward left his OWN watcher clause with no cause, so the log said the ability triggered and
      // never said what arrived — for a clause whose whole point is that something arrived.
      case 'cast': enterHits.push({ card: e.card, controller: e.player, type: e.cardType, used: false }); break
      case 'playedFromDeck':
      case 'playedFromHand': {
        // The card is on the field by the time this is narrated, so the view can name its type.
        const type = defTypeOf(v, e.card)
        if (type) enterHits.push({ card: e.card, controller: e.player, type, used: false })
        break
      }
      case 'broken':
      case 'brokenByAbility': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), reason: 'ability', used: false }); break
      // Rung V1-A2: an effect's put is tagged apart from a break, as the engine's transition is, so the cause reads true.
      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), reason: e.reason === 'ability' ? 'putByAbility' : 'ability', used: false }); break
      // C3: paying a cost moves a card the same way a break does, so an observer of the MOVEMENT fires on it
      // and the log needs the same cause available — tagged, so it is not narrated as a break.
      case 'paidToBreakZone': zoneHits.push({ card: e.card, controller: e.player, reason: 'cost', used: false }); break
      default: break
    }
    let cause: TriggerCause | null = null
    if (e.type === 'abilityTriggered') {
      // C11: an `observesChosen` clause is applied INLINE and never becomes a frame, so it must not consume
      // a queue slot. The pairing above rests on "starting a frame is what emits `abilityTriggered`", and
      // that clause is the one emitter for which it is false — left unguarded, its event shifts the cursor
      // and every later trigger in the batch reads the NEXT frame's cause. Where two queued frames share a
      // watcher card and clause the identity check passes on the wrong one, so the line does not lose its
      // cause, it gains someone else's: the exact failure this pairing exists to prevent (spec C2-A3).
      // Rung J1-D13: the event carries its cause. The placement order is no longer the trigger order (the
      // turn player's clauses go on first, last-triggered first), so the queue-position pairing below cannot
      // be trusted; it stays only for an event from a producer that did not carry one.
      if (e.cause !== undefined) cause = e.cause
      else {
        const framed = triggerOf(v, e.card, e.abilityId)?.kind !== 'observesChosen'
        const frame = framed ? queued[started++] : undefined
        cause = frame && frame.source === e.card && frame.abilityId === e.abilityId
          ? frame.triggerEvent
          : causeOf(v, e, hits, playerHits, zoneHits, enterHits)
      }
    }
    const line = describeEvent(v, e, cause)
    if (line) lines.push(line)
  }
  return lines
}

/**
 * The view a command's events are narrated from: the state AFTER it, plus the cards that were public BEFORE.
 * An ability can move a card out of a public zone into a hidden one — Billy Bob returns a Forward from the
 * Break Zone to its owner's HAND — and `#51 returns to the AI's hand` is a worse log line than naming a card
 * whose identity the player could read off the table a moment ago. Nothing hidden before can enter this union,
 * so B-A3 still holds: `before` is itself a human view.
 */
export const narrator = (before: PlayerView, after: PlayerView): PlayerView => ({ ...after, cards: { ...before.cards, ...after.cards } })

/**
 * Narrate and apply one already-chosen command. Split out of `stepAi` because the browser's opponent no longer
 * comes from an `Agent` at all — it comes back from a worker (spec D2) — and both paths must produce the same
 * log. The membership check is spec B-A4 held to both seats: `apply` is never reached by a command outside
 * `legalCommands`.
 */
function narrateApply(
  state: GameState, legal: readonly Command[], command: Command, control: Control = 'full',
): { state: GameState; lines: LogLine[] } {
  // Rung J7-D1: legality is the engine's predicate, not membership in a list that may be a capped sample.
  const refused = isLegal(state, command)
  if (refused !== null) throw new Error(`agent chose an illegal command: ${command.type} (${refused})`)
  const before = viewFor(state, HUMAN)
  const applied = apply(state, command)
  // Rung J1: the windows the command opened are closed here, before anyone renders them — and what closing
  // them did (the damage a block leads to, a game that ends there) is narrated with the move that caused it.
  const settled = settleWindows(applied.state, { control })
  const result = { state: settled.state, events: [...applied.events, ...settled.events] }
  // The move label and the events that follow it are narrated from the SAME view, and it is the human's.
  //
  // It used to be the ACTOR's, so "a card only it can see still reads sensibly" — which is exactly the leak
  // C9 found. Every command before C9 labelled itself with cards that were public by the time the label was
  // written (a cast lands on the field, a discard lands in the Break Zone), so the actor's view added nothing
  // and cost nothing. `chooseFromDeck` broke that: after a PRIVATE look the actor's view names the card it
  // picked, and this line goes into the log the human reads — "Take Red Mage" for a card Reeve's printed text
  // showed only the AI. The narrator view is a human view by construction (see `narrator`), so it physically
  // cannot name what the human was not shown, and the public-before union keeps every other label intact.
  const view = narrator(before, viewFor(result.state, HUMAN))
  const lines = eventLines(view, result.events, state.resolution.queue)
  // The EVENTS are narrated from the post-apply view; the move LABEL is not, and must not be. `describeChoice`
  // reads the pending the command ANSWERED — for a deck pick's destination, and through `targetVerb` for a
  // target's printed verb — and reads the deck those indices point into. By the time the events exist, that
  // pending has been replaced and the deck has already moved, so a search labelled itself "Take 1 card" for a
  // card it had just put onto the field. Pre-command view, post-command cards: the cards union is the only
  // part that has to look forward, so a cast can still name the card it just made public.
  const label = describeChoice({ ...before, cards: view.cards }, command)
  return { state: result.state, lines: [moveLine(AI, label), ...lines] }
}

/**
 * A move line, with the player who made it IN THE TEXT.
 *
 * The two move lines were the only lines in the log with no subject — every event line already says "You draw
 * 1 card" or "The AI draws 2 cards" — and the seat was carried by colour alone (`--gold` against `#8fb6c9`).
 * Colour is not available to a screen reader, is not available to a colour-blind player, and is not there at
 * all when the log is read as text.
 *
 * Found by playing, on the very first line of a game: the AI held the first-player choice, and its move
 * appeared as a bare "Let the opponent go first" directly above "YOU TAKE THE FIRST TURN". Both are correct —
 * the AI chose to go second — but read as one voice they contradict each other, and the outcome line names the
 * beneficiary rather than the chooser, so nothing on screen said who had decided.
 */
/** Why a rule process — or an effect (rung V1-A2) — put a card into the Break Zone (§12.4.4, §12.4.6–8), in the player's words. */
const BREAK_ZONE_WHY: Record<Extract<Event, { type: 'putIntoBreakZone' }>['reason'], string> = {
  zeroPower: '0 power', sameName: 'two of the same name', lightDark: 'a second Light or Dark card', backupLimit: 'more than five Backups',
  // Rung V1-A2: an effect that says "put into the Break Zone" (§15.1.1.3.2) — not a rule process, and not a break.
  ability: 'by an ability',
}

/** Why an item left the stack unresolved (rung V1-D), in the player's words. */
const STACK_CANCELLED_WHY: Record<Extract<Event, { type: 'stackCancelled' }>['reason'], string> = {
  noTargetAtPlacement: 'it had no legal target as it was put on',   // §11.8.4
  targetsGone: 'every target it chose is gone',                     // §11.11.2
  condition: 'its condition no longer holds',                       // §11.11.3
}

export const moveLine = (actor: PlayerId, label: string): LogLine =>
  ({ kind: actor === HUMAN ? 'human' : 'ai', text: `${actor === HUMAN ? 'You' : 'The AI'}: ${label}` })

/**
 * Apply exactly ONE command for whoever is currently acting, chosen by `agent`, and return the resulting state
 * with the lines it produced. Pure and React-free so the whole driver is testable headlessly (spec B-A7).
 */
export function stepAi(state: GameState, agent: Agent): { state: GameState; lines: LogLine[] } {
  const closed = settleForcedWindows(state)
  const settled = closed.state
  const opening = closed.events.length ? eventLines(viewFor(settled, HUMAN), closed.events, state.resolution.queue) : []
  const p = actingPlayer(settled)
  // Closing a window may hand the decision to the OTHER seat; that seat's move is not this agent's to make.
  if (p === null || (settled !== state && p !== actingPlayer(state))) return { state: settled, lines: opening }
  const actorView = viewFor(settled, p)
  const legal = legalCommands(settled, p)
  const r = narrateApply(settled, legal, agent.decide(actorView, legal))
  return { state: r.state, lines: [...opening, ...r.lines] }
}

/**
 * Apply every decision with one answer, for EITHER seat, silently (rung J1-D14/D15, widened by K2).
 *
 * A window whose only answer is `pass` is not a decision: the human is never shown it (it would be a strip
 * with one button that does nothing), and the AI does not search it (a 600 ms "thinking" pause to pass is a
 * game that feels broken). Rung K2 adds the block declaration with no active Forward and the attack
 * declaration with no Forward able to attack — the same strip with one button, found by playing. Each is
 * applied in the same step as the command that reached it, so no render ever sees it, and no line is written
 * for the forced answers themselves — the move that matters is the one before. What they CAUSE is returned:
 * a window's exit deals the damage of a combat or ends a phase (rung J1-D10), and a game can end there, so
 * the caller narrates these with the move.
 */
export function settleForcedWindows(state: GameState): { state: GameState; events: Event[] } {
  return settleWindows(state, { control: 'full' })
}

/**
 * Rung K5: is this a response window of the human's that Smart passes without showing? The stops (K5-D3):
 * the top of the stack is the AI's — a Summon it cast or an ability it controls, something the human could
 * answer; or the Attack Phase is at `blocked`, the block declared and damage not yet dealt, where combat is
 * decided (in either turn, blocker named or not). Everything else a response window can be is passed: the
 * AI's Main Phases with an empty stack, the `preparation`, `declared` and `damage` windows, and a window
 * whose stack top is the human's OWN Summon or ability — passing hands it to the AI, or resolves it.
 */
export function smartPasses(state: GameState): boolean {
  if (actingPlayer(state) !== HUMAN || !isResponseWindow(state)) return false
  const top = state.stack.at(-1)
  if (top && (top.kind === 'summon' ? top.controller : top.frame.controller) === AI) return false
  if (state.phase === 'attack' && state.attack?.step === 'blocked') return false
  // Rung J2 (review H1): a window in which a CHARACTER could enter — a Back Attack surprise blocker in the AI's
  // `declared` window, say — is a real decision; K5-D4 passed it when only Summons could be cast there.
  if (actionMenu(state, HUMAN).castable.some((c) => defOf(state, c).type !== 'summon' && canAffordCast(state, HUMAN, c))) return false
  return true
}

/**
 * `settleForcedWindows`, plus — under Smart (rung K5, the default) — the human's response windows that
 * `smartPasses` says nobody would hold for. Those are passed too, in the same step, for as long as they keep
 * opening. Never the human's own empty-stack Main Phase (its Pass ends a phase and stays a button), never a
 * decision the game owes (a block, targets, an EX Burst — those are pendings, not windows), never the attack
 * declaration. Under Full control only the forced windows settle. The AI's decisions are its own.
 */
export function settleWindows(state: GameState, opts: { control: Control }): { state: GameState; events: Event[] } {
  let s = state
  const events: Event[] = []
  for (let i = 0; i < 64; i++) {
    const c = forcedDecision(s) ?? (opts.control === 'smart' && smartPasses(s) ? { type: 'pass' as const, player: HUMAN } : null)
    if (!c) break
    const r = apply(s, c)
    s = r.state; events.push(...r.events)
  }
  return { state: s, events }
}

// --- the browser's opponent: SO-ISMCTS in a worker (spec D2) -----------------------------------------------

/** Everything the AI wiring needs from React. Named so the wiring below is drivable without a DOM. */
export interface AiSink {
  commit(state: GameState, lines: LogLine[]): void
  log(line: LogLine): void
  /** Rung K5: the human's control mode right now. Read at commit time, never captured. */
  control?: () => Control
}

/**
 * The hook's side of the coordinator contract. Every race — staleness, pacing, worker death, the fallback — is
 * the coordinator's, so what is left here is only the shape the hook already had: re-check the command against
 * the exact state it was chosen for, narrate it, commit it.
 */
export function aiHandlers(sink: AiSink): SearchRequestHandlers {
  return {
    onCommand: (command, forState) => {
      // Rung J7-D1: the predicate, not the (possibly capped) list. `false` is load-bearing beyond skipping the
      // commit: it is what stops the per-position seed advancing, so the next search of this same board asks
      // the identical question (D2-3). Refuse rather than throw — this runs from a timer, where an uncaught
      // throw would take the page down instead of the move.
      // The seat first: a concede is legal for EITHER player at any time (§2.1), so `isLegal` alone would let
      // the worker concede on the human's behalf — the B-A4 harness sends exactly that.
      const refused = command.player !== AI ? 'not the AI\'s command' : isLegal(forState, command)
      if (refused !== null) {
        sink.log({ kind: 'warning', text: `The AI chose ${command.type}, which is not legal in this position (${refused}) — the move was discarded` })
        return false
      }
      const stepped = narrateApply(forState, legalCommands(forState, AI), command, sink.control?.() ?? 'full')
      sink.commit(stepped.state, stepped.lines)
      return true
    },
    // D2-6, and the reason the rung has a visible warning at all: an opponent quietly a tenth as strong is
    // exactly the degradation that survives a rung unnoticed. The coordinator emits this at most once a game.
    onWarning: (text) => { sink.log({ kind: 'warning', text }) },
  }
}

/** Test seams. The hook passes none of them; the browser gets a real worker and a real clock. */
export type SearchSeams = Pick<SearchCoordinatorOptions, 'createTransport' | 'clock' | 'iterations'>

/** Both seats' declared main-deck lists, seat 0 first — what `determinise` samples each seat's hidden cards from. */
export type DeckLists = readonly [readonly string[], readonly string[]]

export interface AiSearch {
  request(state: GameState, handlers: SearchRequestHandlers): void
  /** Effect cleanup, and any commit the coordinator did not itself make. Synchronous, per D2-4. */
  invalidate(): void
  /** A new game under `seed`, dealt from `decks` — the current lists when absent. */
  restart(seed: number, decks?: DeckLists): void
  dispose(): void
}

/**
 * One `SearchCoordinator` per GAME. Throwing it away is how a restart resets the two things that are per-game
 * facts and would otherwise leak across one: the committed-decision index the search seed is derived from
 * (D2-3), and the permanently-Greedy latch a dead worker sets (D2-6).
 *
 * Built lazily, and rebuilt after `dispose`, because StrictMode's mount→unmount→mount tears the coordinator
 * down without re-rendering — a one-shot construction in the render body would leave the second mount holding
 * a terminated worker and no AI at all.
 */
export function createAiSearch(
  readState: () => GameState, seed: number, opts: { decks: DeckLists; seams?: SearchSeams },
): AiSearch {
  let gameSeed = seed
  // Rung V1-C: the lists are per GAME, like the seed (C-D2). The worker's `init` and the Greedy fallback both read
  // them from the coordinator's options, so rebuilding the coordinator is what moves all of them to a new pair.
  let decks = opts.decks
  let coordinator: SearchCoordinator | null = null
  const drop = (): void => { coordinator?.dispose(); coordinator = null }
  const live = (): SearchCoordinator => (coordinator ??= new SearchCoordinator({
    decks, gameSeed, readState, stepMs: AI_STEP_MS, budget: SEARCH_BUDGET, ...opts.seams,
  }))
  return {
    request: (state, handlers) => { live().request(state, handlers) },
    invalidate: () => { coordinator?.invalidate() },
    restart: (next, nextDecks) => { gameSeed = next; decks = nextDecks ?? decks; drop() },
    dispose: drop,
  }
}

/**
 * The game the web app deals: `pair` is `[you, the AI]`, seat 0 then seat 1, each seat with its own main and LB
 * deck (rung V1-C). Exported so tests deal exactly the game the hook does, rather than a copy of it.
 */
export const createWebGame = (seed: number, pair: DeckPair): GameState =>
  createGame({ seed, defs: CARD_DEFS, ...deckLists(pair) })

/** C-D2: the pair is part of the game's identity, so the log says which decks it is before anything else. */
const openingLog = (pair: DeckPair): LogLine[] =>
  [{ kind: 'phase', text: `New game — you play ${DECK_CHOICES[pair[0]].name}, the AI plays ${DECK_CHOICES[pair[1]].name}` }]

/**
 * Is the game waiting on the AI? This is the ONE definition — the prompt strip's "thinking" line, the inert
 * board, and the effect that requests a search all read it, so none of them can drift from the others.
 *
 * A finished game needs no clause of its own: `actingPlayer` already returns null once `result` is set.
 */
export const aiIsThinking = (state: GameState): boolean => actingPlayer(state) === AI

export function useGame(seed?: number, opts: { decks?: DeckPair; seams?: SearchSeams } = {}): GameApi {
  const seedRef = useRef<number>(seed ?? Date.now() % 2_147_483_647)
  // Rung V1-C (R2): the ACTIVE game's pair. Separate from whatever a picker currently shows, and changed only by
  // `restart` — a select that moved mid-game must not touch the game being played or the worker searching it.
  const [decks, setDecks] = useState<DeckPair>(() => opts.decks ?? DEFAULT_DECKS)
  const decksRef = useRef<DeckPair>(decks)
  // The same seam `createAiSearch` already takes, lifted one level so the HOOK can be rendered in a test with
  // a clock and transport under the test's control. Production passes nothing and gets a real worker.
  const seamsRef = useRef<SearchSeams>(opts.seams ?? {})
  // Spec B3: the ground truth lives here and only `viewFor(state, HUMAN)` ever leaves the hook. `stateRef` is
  // the authority `choose` reads, so two clicks inside one render can't both apply to the same stale state.
  const [state, setState] = useState<GameState>(() => createWebGame(seedRef.current, decksRef.current))
  const stateRef = useRef<GameState>(state)
  const searchRef = useRef<AiSearch | null>(null)
  // Lazy for the same reason the game itself is: `useRef(createAiSearch(...))` would build one every render.
  searchRef.current ??= createAiSearch(() => stateRef.current, seedRef.current, { decks: deckLists(decksRef.current).decks, seams: seamsRef.current })
  const [log, setLog] = useState<LogLine[]>(() => openingLog(decksRef.current))

  const commit = useCallback((next: GameState, lines: LogLine[]) => {
    stateRef.current = next
    setState(next)
    if (lines.length) setLog((prev) => [...prev, ...lines])
  }, [])

  const appendLog = useCallback((line: LogLine) => { setLog((prev) => [...prev, line]) }, [])
  // Rung K4/K5: the full-control toggle. A ref beside the state so the AI's commit path (a timer, closed over
  // the handlers) reads the live value, and the state so the strip re-renders the control.
  const [fullControl, setFullControlState] = useState(false)
  const fullControlRef = useRef(false)
  const control = (): Control => (fullControlRef.current ? 'full' : 'smart')
  const handlers = useMemo(() => aiHandlers({ commit, log: appendLog, control }), [commit, appendLog])

  const view = useMemo(() => viewFor(state, HUMAN), [state])
  // The RAW legal commands go to `paymentAlternatives` and the COLLAPSED ones to `buildChoiceSet`: the strip
  // shows one action per move, and the other ways to fund that move ride along on it (rung E11).
  const choices = useMemo(() => {
    const { commands: legal, capped } = legalCommandsWithMeta(state, HUMAN)
    return buildChoiceSet(view, preferredChoices(view, legal), paymentAlternatives(legal), capped)
  }, [state, view])

  const choose = useCallback((choice: Choice): void => {
    const current = stateRef.current
    // Spec B-A4: prove the command is still legal before touching `apply`, so an illegal click is impossible
    // rather than merely rejected by the engine after the fact.
    //
    // This check comes BEFORE the invalidation, and the order matters. Invalidating first meant a stale click
    // that turned out to be illegal had already cancelled the AI's outstanding search on its way to throwing:
    // state unchanged, nothing outstanding, and no reason for the state-keyed effect to request again — the
    // AI simply stopped. Nothing happens between these two statements, so there is no window to protect.
    const refused = isLegal(current, choice.command)
    if (refused !== null) throw new Error(`illegal command: ${choice.label} (${refused})`)
    // D2-4: an external commit synchronously drops whatever the AI has outstanding. `concede` is legal even
    // when the human is NOT the acting player, so a click really can land in the middle of the AI's search.
    searchRef.current?.invalidate()
    const before = viewFor(current, HUMAN)
    const applied = apply(current, choice.command)
    // Rung J1: close the pass-only windows the move opened — the AI's forced pass and the human's own — in
    // this same commit, so no render ever shows a strip whose one button does nothing. K5: under Smart, the
    // human's response windows nobody would hold for, too.
    const settled = settleWindows(applied.state, { control: control() })
    const result = { state: settled.state, events: [...applied.events, ...settled.events] }
    const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, current.resolution.queue)
    commit(result.state, [moveLine(HUMAN, describeChoice(before, choice.command)), ...lines])
  }, [commit])

  /**
   * K5-D5 (K4-D3 mirrored): turning full control OFF is itself the answer to whatever window is open — the
   * human's, right now — so the position is settled under Smart at once, narrated like any other settlement.
   * Turning it on does nothing retroactively.
   */
  const setFullControl = useCallback((on: boolean): void => {
    fullControlRef.current = on
    setFullControlState(on)
    if (on) return
    const current = stateRef.current
    const settled = settleWindows(current, { control: 'smart' })
    if (settled.state === current) return
    searchRef.current?.invalidate()
    const lines = eventLines(narrator(viewFor(current, HUMAN), viewFor(settled.state, HUMAN)), settled.events, current.resolution.queue)
    commit(settled.state, lines)
  }, [commit])

  const restart = useCallback((nextDecks?: DeckPair): void => {
    // K4-D5: the toggle is "for now", not a preference.
    fullControlRef.current = false
    setFullControlState(false)
    // A fresh but reproducible seed: `useGame(seed)` stays deterministic across restarts, which tests rely on.
    const next = ++seedRef.current
    // Rung V1-C: the pair the caller chose, or the one just played. This is the only place the active pair moves.
    const pair = nextDecks ?? decksRef.current
    decksRef.current = pair
    setDecks(pair)
    const game = createWebGame(next, pair)
    stateRef.current = game
    // D2-3: a new coordinator, so the committed-decision index the search seed is derived from restarts at 0 —
    // and, since V1-C, so the worker and the Greedy fallback are handed the new game's lists.
    searchRef.current?.restart(next, deckLists(pair).decks)
    setState(game)
    setLog(openingLog(pair))
  }, [])

  // Spec B7 + D2: one AI move per decision, searched off the main thread. Re-running on every `state` change is
  // what makes it a loop, and one accepted request per state is what stops two AI moves overlapping. The
  // cleanup invalidates synchronously, so StrictMode's mount→unmount→mount double-invoke discards the first
  // request rather than stepping the AI twice.
  useEffect(() => {
    if (!aiIsThinking(state)) return
    const search = searchRef.current as AiSearch
    search.request(state, handlers)
    return () => { search.invalidate() }
  }, [state, handlers])

  // Unmount only. A worker outliving its hook is both a leak and a source of replies for a game nobody is
  // looking at any more (D2-4).
  // Layout, not passive: passive cleanup runs AFTER the DOM is gone, so a worker result queued in between
  // would be processed — and could even schedule a zero-delay delivery — against an unmounted component.
  // Disposal has to be synchronous with unmount, the same way every other invalidation here is.
  useLayoutEffect(() => () => { searchRef.current?.dispose() }, [])

  // DERIVED, never stored. It was a `useState` cleared inside the effect below, so it lagged one render behind
  // `choices`: the instant an AI move handed the turn back, the board rendered the human's blocker choice as
  // clickable while the strip still read "The AI is thinking" (found by playing — a driven click landed in
  // exactly that window). Computing it here, from the same `state` the choices came from, makes the two
  // disagreeing impossible rather than merely unlikely, and fixes the mirror case for free: the strip no
  // longer shows a stale human prompt for a render after the AI takes over.
  return { view, choices, log, aiThinking: aiIsThinking(state), choose, restart, fullControl, setFullControl, decks }
}
