import type { CardType, Element, Keyword, PlayerId } from './types.js'
import type { CardId } from './state.js'

/**
 * The ability AST (spec C1-1/C1-2). Abilities are DATA, hand-written per clause and hung off `CardDef`,
 * never parsed from `def.text` at runtime and never functions.
 *
 * Everything in this file must stay plain records/arrays/strings/numbers/booleans, readonly, with no
 * `Map`/`Set`/closures, because:
 *   - `viewFor` and `determinise` both end in `structuredClone`, which strips functions outright;
 *   - `determinise` rebuilds a GameState from a PlayerView whose only card-definition channel is
 *     `view.defs` — so hanging the AST on `CardDef` is what makes the AI simulate the SAME game it
 *     plays. An injected function registry silently gives the AI a vanilla game (spec C1-2);
 *   - self-play's strict mode detects mutation with `JSON.stringify`, and `session.ts` serialises
 *     `CreateGameOptions`.
 */

/** Which pile a target is drawn from. */
export type TargetZone = 'forwards' | 'backups' | 'breakZone'

/** Whose cards are eligible. `any` means either player's. */
export type TargetController = 'self' | 'opponent' | 'any'

export interface TargetFilter {
  readonly type?: CardType
  /**
   * Any of these types. "Character" is Forward, Backup OR Monster — never Summon — and a single `type`
   * cannot say that, which both Prishe's and Luso's Break-Zone retrieval need (spec C2-9).
   */
  readonly types?: readonly CardType[]
  readonly element?: Element
  /** Inclusive printed-cost ceiling, e.g. Lightning's "cost 4 or less" (C2). */
  readonly maxCost?: number
  /** EXACT printed cost, e.g. Hugh Yurg's "a Forward of cost 1" (C8). Not a ceiling — `maxCost` is that. */
  readonly cost?: number
  /** "other than <this card>" — excludes the ability's own source. */
  readonly excludeSource?: boolean
  /** "other than Card Name <X>" — excludes every card sharing the source's name (Billy Bob). */
  readonly excludeSourceName?: boolean
  /**
   * "put in your Break Zone from the field during this turn" — Sphene's retrieve (spec C10-2). A fact about
   * the INSTANCE and the state, not the definition, so it is checked in `matchesFilter` and deliberately not
   * in `matchesDefFilter`, which is definition-only and is what the search's decoder may ask of a view.
   */
  readonly putIntoBreakZoneFromFieldThisTurn?: boolean
}

export interface TargetSpec {
  readonly zone: TargetZone
  readonly controller: TargetController
  readonly filter?: TargetFilter
}

/**
 * One step of an ability. Effects are executed in order by the resolution agenda; the ones that need a
 * player decision suspend the frame and raise a `Pending` (spec C1-3/C1-6).
 *
 * `chooseTargets` and `chooseModes` are the only effects that can suspend. `then`/`effects` nest, which
 * is what lets Shantotto raise a mode choice whose chosen branch then raises a target choice.
 */
export type Effect =
  /** Choose `min..max` targets, then run `then` once with `chosen` bound to them. min 0 = "up to". */
  | { readonly kind: 'chooseTargets'; readonly min: number; readonly max: number; readonly from: TargetSpec; readonly then: readonly Effect[] }
  /** Choose `min..max` of `modes` ("select up to 2 of the 3 following"); chosen modes run in listed order. */
  | { readonly kind: 'chooseModes'; readonly min: number; readonly max: number; readonly modes: readonly AbilityMode[] }
  /** Run `do` once per card matching `from`, with `chosen` bound to that one card. Untargeted — no choice. */
  | { readonly kind: 'forEach'; readonly from: TargetSpec; readonly do: readonly Effect[] }
  | { readonly kind: 'dull' }
  | { readonly kind: 'damage'; readonly amount: number }
  | { readonly kind: 'breakCard' }
  | { readonly kind: 'addPower'; readonly amount: number }
  | { readonly kind: 'grantKeyword'; readonly keyword: Keyword }
  | { readonly kind: 'grantFlag'; readonly flag: FieldFlag }
  | { readonly kind: 'moveToHand' }
  /**
   * Draw `count` cards for the resolving ability's controller. The primitive itself lives in `draw.ts` rather
   * than `phases.ts`, because `phases.ts` imports `resolve.ts` and so cannot be imported back (spec C3-9).
   */
  | { readonly kind: 'draw'; readonly count: number }
  /**
   * "Look at / reveal the top N of your deck. Add one among them to your hand, and return the rest to the
   * bottom" — Reeve and Miner (spec C9). One effect for both: they differ in `count`, in `take.filter`, and
   * in `audience`, which is the whole of the private/public distinction.
   */
  | {
      readonly kind: 'lookAtDeck'
      /** How many from the top, or `'all'` — the whole deck, which is what a SEARCH exposes (spec C9). */
      readonly count: number | 'all'
      /** `self` is a LOOK (private to the controller); `all` is a REVEAL (both players learn the cards). */
      readonly audience: 'self' | 'all'
      readonly take: { readonly min: number; readonly max: number; readonly filter?: TargetFilter }
      /**
       * Where a taken card goes. `field` is Hugh Yurg's "play it onto the field" — it goes through the same
       * `putOntoField` a cast does, so its own ETB and every watcher fire exactly as if it had been cast.
       */
      readonly to: 'hand' | 'field'
      /**
       * What happens to the ones not taken. `bottom` keeps them in exposed order; `shuffle` is what makes a
       * search legal to look at a whole deck — it is the only thing in the engine that calls `forget`, and
       * without it the controller would keep perfect knowledge of a 40-card deck for the rest of the game.
       */
      readonly rest: 'bottom' | 'shuffle'
    }
  /**
   * Act on the card the TRIGGER EVENT is about — Luso's "break **it**" (spec C2-5). Binds `chosen` to the
   * event's subject and runs `do`, so every existing effect works on it unchanged. Deliberately NOT a target
   * choice: "it" is named by the printed text, and offering it as a choice would let the player retarget a
   * printed effect. A no-op when the frame has no trigger event, or the subject is not a card.
   */
  | { readonly kind: 'onSubject'; readonly do: readonly Effect[] }

/**
 * Until-end-of-turn protections that `granted: Keyword[]` cannot express (spec C1-7).
 *
 * `cannotBeReturnedByOpponent` is granted, rendered and tested, but NOTHING CONSULTS IT YET (spec C5-4):
 * every `moveToHand` in the pool targets the Break Zone, so no effect returns a Forward from the field to
 * hand. It exists because it is half of Cloud's printed clause, and it gets its enforcement point and its
 * test the day a return effect arrives — until then it must not be described as protecting anything.
 */
export const FIELD_FLAGS = ['cannotBeBroken', 'cannotBeReturnedByOpponent'] as const
export type FieldFlag = (typeof FIELD_FLAGS)[number]

export interface AbilityMode {
  /** Stable identifier, and the text the UI shows on the button. Quote the printed wording. */
  readonly label: string
  readonly effects: readonly Effect[]
}

/** Which side of the watcher a moved/damaged card must be on, relative to the WATCHER's controller. */
export type TriggerWhose = 'self' | 'opponent' | 'any'

/**
 * When a clause fires. The first two are "this card just did something" and are all C1 needed. The last two
 * are C2's observer triggers: something happened, and this card was watching — which is why they carry a
 * predicate rather than being bare strings.
 *
 * `enterField` covers casting AND being put onto the field by another ability (C3's Hugh Yurg), which is
 * why it is not keyed off the `cast` event.
 */
export type AbilityTrigger =
  | { readonly kind: 'enterField' }
  | { readonly kind: 'summonResolve' }
  /**
   * THIS card dealt damage — combat or ability alike (spec C2-7). `whose` is the DAMAGED side relative to
   * this card's controller: Luso and Prishe both print "deals damage to **your opponent**", and without it the
   * restriction lives nowhere in code and any future self-damage or redirect path fires them wrongly.
   */
  | { readonly kind: 'dealtDamage'; readonly to: 'forward' | 'player'; readonly whose: TriggerWhose }
  /**
   * Some OTHER card moved, and this one was watching (spec C2-3/C2-4). `of` is the moved card's TYPE:
   * Lightning watches "a **Forward** … put from the field into the Break Zone", and leaving that restriction
   * implicit in "the only producer happens to scan the forwards array" makes it fire on the first Backup a
   * later rung breaks.
   */
  | { readonly kind: 'observesZoneChange'; readonly from: 'field'; readonly to: 'breakZone'; readonly whose: TriggerWhose; readonly of: CardType }
  /**
   * Some OTHER card ARRIVED on a field, and this one was watching (spec C8-1) — `observesZoneChange` pointed
   * the other way. `whose` resolves against the WATCHER's controller, never the turn player, exactly as
   * C2-10 settled for its mirror: Hugh Yurg prints "enters **your** field".
   *
   * `of` is the arriving card's TYPE and `filter` narrows it further — Hugh Yurg watches "a **Forward** of
   * **cost 1**". Both are explicit rather than implicit in which array the producer happens to scan, which is
   * the mistake C2 had to call out once already.
   */
  | { readonly kind: 'observesEnterField'; readonly whose: TriggerWhose; readonly of: CardType; readonly filter?: TargetFilter }
  /**
   * The beginning of the Attack Phase, on the CONTROLLER's own turn (spec C5-2). Cloud prints "during each of
   * your turns", and that restriction lives in the dispatch rather than on the card: a clause that fired on
   * the opponent's turn too would hand them a free protection every round, which one Cloud on one side of a
   * fixture cannot detect.
   */
  | { readonly kind: 'attackPhaseBegins' }
  /**
   * NOT a trigger at all: an ability the player chooses to use (spec C3-1). It lives in this union because
   * every dispatch site already switches on `kind`, so an activated ability is inertly ignored by trigger
   * dispatch — and the compiler finds any switch that forgot it.
   *
   * `sourceZone` is an activation PRECONDITION, not part of the cost (C3-3): Geomancer's ability is usable
   * only from hand, and inferring that from "its cost discards itself" would need replacing the moment a
   * Break-Zone ability arrives.
   */
  | {
      readonly kind: 'activated'
      readonly sourceZone: ActivationSourceZone
      readonly cost: AbilityCost
      /**
       * "You can only use this ability once per turn" (spec C10-1). Tracked on the source's `FieldCard`, so
       * it is only meaningful for `sourceZone: 'field'` — an ability activated from hand or the Break Zone
       * has no such carrier, and `checkInvariants` rejects that combination rather than letting it silently
       * never limit anything.
       */
      readonly oncePerTurn?: boolean
    }
  /**
   * "When <this> is chosen by a Summon or an ability" — Prishe (spec C11).
   *
   * Dispatched INLINE, at the two points a target becomes fixed, rather than through the resolution agenda:
   * the effect must not be able to suspend, because an inline application has nowhere to suspend to, and
   * `dispatchChosenTriggers` rejects a suspending shape loudly rather than dropping it.
   *
   * Not the same as a preempting frame, and the difference is reachable — see the MVP0-SIMPLIFICATION on
   * `dispatchChosenTriggers`.
   */
  | { readonly kind: 'observesChosen' }
  /**
   * NOT a trigger either, and unlike an activated ability it never RESOLVES at all (spec C4-1). A static
   * ability is simply true, continuously, and the rules consult it: it never reaches the resolution agenda,
   * emits no event, and consumes no resolution steps.
   *
   * It lives in this union for the same reason `activated` does — every dispatch site already switches on
   * `kind`, so trigger dispatch ignores it inertly and the compiler finds any switch that forgot it.
   */
  | { readonly kind: 'static'; readonly effect: StaticEffect }

/**
 * What a static ability makes true. Exactly ONE shape today, deliberately: a second arrives when a second
 * card needs one, and the union makes adding it a compile-time exercise rather than a guess now.
 */
export type StaticEffect =
  /**
   * "the cost required to cast <this card> is reduced by N" — Odin. Note the scope: it modifies its OWN
   * card's cost, from wherever that card is (Odin's is read while it sits in hand), rather than radiating
   * from the field the way a Break-Zone protection would. Making the scope explicit now is what keeps
   * Sphene's field-scoped static from being a rewrite.
   */
  | { readonly kind: 'costReduction'; readonly amount: number; readonly when: StaticCondition }
  /**
   * "<this card> can produce <Element> CP" — Moogle. The FIELD-scoped static C4 said would come: unlike
   * `costReduction`, which its own card carries while sitting in hand, this one applies only while the card
   * is on the field, which is what the printed text says. Read where CP is generated and nowhere else.
   */
  | { readonly kind: 'produceElement'; readonly element: Element }

/**
 * When a static applies. Plain data, never a predicate function: card definitions travel through
 * `structuredClone` into the search and into the Web Worker, which strips functions — the same constraint
 * that made the whole ability system an AST.
 */
export type StaticCondition =
  /** "If you have received N points of damage or more" — the CASTER's damage zone (§9.4). */
  | { readonly kind: 'damageReceived'; readonly atLeast: number }

export type ActivationSourceZone = 'field' | 'hand' | 'breakZone'

/** Mirrors `ZoneTransition.reason` (rules.ts); declared here so the trigger event can carry it without a cycle. */
export type ZoneTransitionReason = 'zeroPower' | 'damage' | 'ability' | 'cost'

/**
 * What activating costs. Every part is paid at once or the activation is not legal at all (§11.6.10) — there
 * is no partial payment and no "pay what you can".
 */
export interface AbilityCost {
  /**
   * CP. `amount` is the number required and `requiredElements` the Elements that must be among them, which
   * is NOT derivable from the card's printed cost: Red Mage's ability costs `[Lightning]` (1, Lightning) on a
   * printed-2 card, and Miner's costs `[2]` (2, generic) on a printed-3. `[0]` is `{ amount: 0 }` and admits
   * only the empty payment.
   */
  readonly cp?: { readonly amount: number; readonly requiredElements?: readonly Element[] }
  /**
   * The dull icon. Gates active status and the entered-this-turn/Haste rule (§11.6.2.2) — and ONLY when
   * present: Undead Princess's cost is a self-break with no dull icon, so she may activate while dulled and
   * on the turn she enters.
   */
  readonly dull?: true
  /**
   * "Put <this card> into the Break Zone". NOT a break (§15.1.1.3.2): `cannotBeBroken` does not prevent it
   * and it emits no `broken` event — but it IS a zone movement, so observers of "put from the field into the
   * Break Zone" must still see it (spec C3-7).
   */
  readonly selfToBreakZone?: true
  /** "discard <this card>", from hand. */
  readonly selfDiscard?: true
  /**
   * "Remove <this card> … from the game" — Undead Princess, paid from the Break Zone (spec C7-2).
   *
   * Not a break and not a discard: it produces no `ZoneTransition` (a transition is `to: 'breakZone'` by
   * construction) and emits its own event, so nothing counting breaks or discards counts this.
   */
  readonly selfRemoveFromGame?: true
}

/**
 * What the trigger was about, carried on the frame so `onSubject` can act on it and the log can narrate it.
 * Plain data: it rides on `GameState` through `structuredClone` like everything else.
 */
export type TriggerEvent =
  | { readonly kind: 'damage'; readonly source: CardId; readonly sourceController: PlayerId; readonly target: CardId | null; readonly victim: PlayerId | null; readonly amount: number }
  /**
   * `reason` rides along so narration can tell the player what actually happened. Every transition into the
   * Break Zone used to be described as "was broken", which stopped being true in C3: a card put there to PAY
   * for its own ability was not broken (§15.1.1.3.2), and saying so would misreport the board.
   */
  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly from: 'field'; readonly to: 'breakZone'; readonly controller: PlayerId; readonly owner: PlayerId; readonly reason: ZoneTransitionReason }
  /** A card arrived on a field (spec C8-1). `controller` is whose field it entered. */
  | { readonly kind: 'enteredField'; readonly card: CardId; readonly controller: PlayerId }

export interface Ability {
  /**
   * Stable per-clause id, `<card code>:<slug>` (e.g. `16-092C:etb`). Coverage is tracked per CLAUSE, not
   * per card (spec C1-9): no card in this pool is wholly inside one rung, so a card keeps emitting
   * `unimplementedAbility` for the clauses that are still unimplemented even after this one lands.
   */
  readonly id: string
  readonly trigger: AbilityTrigger
  /** The printed wording this AST encodes, quoted verbatim. Reviewers check the AST against THIS. */
  readonly text: string
  readonly effects: readonly Effect[]
}

// ---------------------------------------------------------------------------
// Resolution agenda (spec C1-3)
// ---------------------------------------------------------------------------

/**
 * A suspended ability in mid-execution. `path` is the program counter: an index per nesting level, so a
 * frame can resume inside `then`/`modes`/`do` after a player answers. `chosen` is the target binding the
 * innermost `chooseTargets`/`forEach` established.
 */
export interface Frame {
  readonly abilityId: string
  /** The card whose ability this is — resolves `excludeSource`, and it may already have left the field. */
  readonly source: CardId
  /** The player who controls the ability and therefore answers its choices. */
  readonly controller: PlayerId
  readonly path: readonly number[]
  readonly chosen: readonly CardId[]
  /**
   * What fired this clause, for `onSubject` and for narration. Null for `enterField`/`summonResolve`, which
   * are about the source itself. It must survive prompts and the source leaving the field (spec C2-5).
   */
  readonly triggerEvent: TriggerEvent | null
  /** Modes picked by an enclosing `chooseModes`, as indices into its `modes`. */
  readonly modes: readonly number[]
  /** Indices answered to a `chooseFromDeck` (spec C9-1). Separate from `modes`: a different question. */
  readonly picks?: readonly number[]
  /**
   * How this frame came to exist. Absent means `'triggered'`, which every C1/C2 frame is.
   *
   * It exists so the log can stop calling an activation a trigger. An activated ability's action frame runs
   * through the same agenda as a triggered one — which is right, they resolve identically — but starting a
   * frame emitted `abilityTriggered` unconditionally, so a move the player deliberately made was narrated
   * both as "activates" and as "triggers" in the same breath.
   */
  readonly origin?: 'triggered' | 'activated'
}

/**
 * Work the engine owes itself. `pending` stays exactly what it always was — the ONE decision a player
 * currently owes — and is cleared before the agenda resumes; this is the queue behind it.
 */
export interface Resolution {
  /** The frame currently executing, if any. Corresponds 1:1 with a non-null ability `pending`. */
  readonly active: Frame | null
  /** Triggered clauses waiting their turn, in trigger order. */
  readonly queue: readonly Frame[]
  /**
   * A system continuation to run once the queue drains — e.g. finishing a phase transition that a
   * trigger interrupted. C1 has none; C2's Cloud Attack-Phase clause is the first.
   */
  readonly continuation: 'enterAttackDeclaration' | null
  /**
   * Total effect steps spent, across the WHOLE agenda and PERSISTING across player choices (spec C1-5).
   * A call-depth cap would not catch a trigger cycle that launders itself through a `chooseTargets`
   * prompt. Exceeding `MAX_RESOLUTION_STEPS` throws loudly rather than hanging the browser.
   */
  readonly steps: number
}

export const MAX_RESOLUTION_STEPS = 512

export const EMPTY_RESOLUTION: Resolution = { active: null, queue: [], continuation: null, steps: 0 }

/**
 * Does the agenda still owe the engine anything? A `continuation` counts: it is work only `drainResolution`
 * consumes, so settlement, `checkInvariants` and the AI's diagnostics that looked at `active`/`queue` alone
 * would call a state with nothing but a continuation "settled" and strand it there permanently.
 */
export function hasResolutionWork(r: Resolution): boolean {
  return r.active !== null || r.queue.length > 0 || r.continuation !== null
}

/**
 * The printed cost, rendered the way the card prints it — `[Lightning][Dull]`, `[2][Dull], put into the Break
 * Zone`. Lives here so the CLI and the browser cannot drift into describing the same ability differently.
 */
export function describeAbilityCost(cost: AbilityCost): string {
  // Icons run together and prose is comma-separated, because that is how the cards print it:
  // `[2][Dull], put Miner into the Break Zone` — never `[2], [Dull], put ...`.
  let icons = ''
  if (cost.cp) {
    const els = cost.cp.requiredElements ?? []
    // A required Element prints as its own icon; a generic cost prints as the number.
    icons += els.length ? els.map((e) => `[${e[0]?.toUpperCase()}${e.slice(1)}]`).join('') : `[${cost.cp.amount}]`
  }
  if (cost.dull) icons += '[Dull]'
  const prose: string[] = []
  if (cost.selfToBreakZone) prose.push('put into the Break Zone')
  if (cost.selfDiscard) prose.push('discard')
  if (cost.selfRemoveFromGame) prose.push('remove from the game')
  return [icons, ...prose].filter(Boolean).join(', ') || '[0]'
}

/**
 * The EFFECT half of a printed ability — what the clause DOES, with the cost and the legality boilerplate off.
 *
 * A card prints `COST: EFFECT`, so a UI showing only the cost tells the player what a click will SPEND and not
 * what it buys. Nothing in this app renders rules text, so before this there was no way to find out short of
 * clicking (found by playing: the button read `[Earth], discard: Geomancer`).
 *
 * The FIRST `": "` is the cost separator — the cost always comes first, and an effect may legitimately contain
 * a later one, since a clause that grants a clause quotes a whole `cost: effect` inside itself.
 *
 * "You can only use this ability …" sentences are dropped as TIMING conditions the engine has already enforced:
 * the button does not exist unless it is your Main Phase, unless the card is in your hand, and so on, so on a
 * button they are words that cannot change the decision. Once-per-turn is the exception and comes back as a
 * short marker (Codex MAJOR): it is not about whether you MAY press the button now but about what pressing it
 * costs you for the rest of the turn, which is a decision the player still has to make. It is read off
 * `trigger.oncePerTurn` rather than out of the prose, because that is where the engine keeps the fact.
 *
 * The trailing full stop goes too, because callers continue the sentence. Returns null when nothing is left to
 * say, so a caller can fall back to naming the clause.
 */
export function describeAbilityEffect(ability: Ability): string | null {
  const split = ability.text.indexOf(': ')
  const body = split === -1 ? ability.text : ability.text.slice(split + 2)
  const kept = body.split(/(?<=\.)\s+/).filter((sentence) => !/^You can only use this ability/.test(sentence))
  const effect = kept.join(' ').trim().replace(/\.$/, '')
  if (!effect) return null
  const once = ability.trigger.kind === 'activated' && ability.trigger.oncePerTurn === true
  return once ? `${effect} (once per turn)` : effect
}

/**
 * The effect node a suspended frame is sitting on, found by walking its program counter (`path`, with
 * `modes` recording which branch each `chooseModes` took). `null` if the counter does not address a node.
 *
 * ONE implementation, deliberately. There were three — the engine's private `effectAt`, the browser's
 * `nodeAt` and the AI's own copy in `candidates.ts` — each with a comment explaining why it was duplicating
 * the others. They were identical, so nothing was broken; the risk was drift, and it was not symmetric.
 * The browser's copy drives WORDING and the AI's drives MOVE QUALITY, so a divergence there would show up
 * as the AI quietly playing worse, with no test failing, and `apply` re-deriving candidates from the engine
 * copy would keep the game legal the whole time — the failure mode with no alarm on it.
 *
 * Pure and total: no state, no throwing, no fallback guessing. A caller that wants to guess at a path it
 * cannot follow does that itself (the browser's `targetVerb` has such a fallback); engine validation must
 * REJECT an invalid program counter rather than guess at one, so the guess cannot live in here.
 */
export function effectAtPath(
  effects: readonly Effect[],
  path: readonly number[],
  modes: readonly number[],
): Effect | null {
  const walk = (level: readonly Effect[], depth: number): Effect | null => {
    const i = path[depth]
    if (i === undefined) return null
    const eff = level[i]
    if (!eff) return null
    if (depth === path.length - 1) return eff
    if (eff.kind === 'chooseTargets') return walk(eff.then, depth + 1)
    if (eff.kind === 'chooseModes') {
      // `chooseModes` owns TWO levels of the counter: which of the chosen modes, then the index within it.
      const k = path[depth + 1]
      if (k === undefined) return null
      const mode = eff.modes[modes[k] ?? -1]
      return mode ? walk(mode.effects, depth + 2) : null
    }
    return null
  }
  return walk(effects, 0)
}
