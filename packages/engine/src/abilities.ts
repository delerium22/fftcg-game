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
  /** "other than <this card>" — excludes the ability's own source. */
  readonly excludeSource?: boolean
  /** "other than Card Name <X>" — excludes every card sharing the source's name (Billy Bob). */
  readonly excludeSourceName?: boolean
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
   * Act on the card the TRIGGER EVENT is about — Luso's "break **it**" (spec C2-5). Binds `chosen` to the
   * event's subject and runs `do`, so every existing effect works on it unchanged. Deliberately NOT a target
   * choice: "it" is named by the printed text, and offering it as a choice would let the player retarget a
   * printed effect. A no-op when the frame has no trigger event, or the subject is not a card.
   */
  | { readonly kind: 'onSubject'; readonly do: readonly Effect[] }

/** Until-end-of-turn protection that `granted: Keyword[]` cannot express (spec C1-7). */
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
  | { readonly kind: 'activated'; readonly sourceZone: ActivationSourceZone; readonly cost: AbilityCost }
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
  return [icons, ...prose].filter(Boolean).join(', ') || '[0]'
}
