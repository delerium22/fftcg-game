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
   * Act on the card the TRIGGER EVENT is about — Luso's "break **it**" (spec C2-5). Binds `chosen` to the
   * event's subject and runs `do`, so every existing effect works on it unchanged. Deliberately NOT a target
   * choice: "it" is named by the printed text, and offering it as a choice would let the player retarget a
   * printed effect. A no-op when the frame has no trigger event, or the subject is not a card.
   */
  | { readonly kind: 'onSubject'; readonly do: readonly Effect[] }

/** Until-end-of-turn protection that `granted: Keyword[]` cannot express (spec C1-7). */
export const FIELD_FLAGS = ['cannotBeBroken'] as const
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
  /** THIS card dealt damage — combat or ability alike (spec C2-7). */
  | { readonly kind: 'dealtDamage'; readonly to: 'forward' | 'player' }
  /** Some OTHER card moved, and this one was watching (spec C2-3/C2-4). */
  | { readonly kind: 'observesZoneChange'; readonly from: 'field'; readonly to: 'breakZone'; readonly whose: TriggerWhose }

/**
 * What the trigger was about, carried on the frame so `onSubject` can act on it and the log can narrate it.
 * Plain data: it rides on `GameState` through `structuredClone` like everything else.
 */
export type TriggerEvent =
  | { readonly kind: 'damage'; readonly source: CardId; readonly sourceController: PlayerId; readonly target: CardId | null; readonly victim: PlayerId | null; readonly amount: number }
  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly from: 'field'; readonly to: 'breakZone'; readonly controller: PlayerId; readonly owner: PlayerId }

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
