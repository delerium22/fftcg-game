import type { CardDef, CardType, Element, Keyword, PlayerId } from './types.js'
import type { CardId, StackItem } from './state.js'

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

/**
 * Which pile a target is drawn from. `hand` (rung V1-A2, spec V1-D11) is the controller's OWN hand and only through a
 * select — Yuna's "play … from your hand", Porom's "discard"; game creation refuses any other use. Its candidates are
 * hidden from the other seat (`viewFor`) and re-sampled by `determinise`. `characters` (rung V1-A4) is a player's field
 * Characters (§5.2.3.1.1.1) — their Forwards, then their Backups — LB Luso's "choose 1 Character you control".
 */
export type TargetZone = 'forwards' | 'backups' | 'breakZone' | 'hand' | 'characters'

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
  // --- rung J5: the printed selectors the next sets use as often as cost and element ---
  /** "Job Dragoon" — the printed Job, exactly. Never matches a card whose job is unknown (`CardDef.job` absent). */
  readonly job?: string
  /** "Category VII" — any of the card's printed categories. Never matches a card whose categories are unknown. */
  readonly category?: string
  /** "Card Name Cloud" — the printed name, exactly. */
  readonly name?: string
  /** A PRINTED keyword ("a Forward with Haste" read from the card). For granted-or-printed, `grantedKeyword`. */
  readonly keyword?: Keyword
  /** Inclusive power bounds on EFFECTIVE power where the card is on the field (bonuses count), printed power elsewhere. */
  readonly minPower?: number
  readonly maxPower?: number
  /** "dull Forward" / "active Forward" — the instance's status; matches nothing off the field. */
  readonly status?: 'active' | 'dull'
  /** A keyword the instance HAS: printed or granted this turn; off the field, printed only. */
  readonly grantedKeyword?: Keyword
  // --- rung V1-A3 (spec V1-D12) ---
  /**
   * "Card Name Palom or Card Name Porom" (Leonora), "Job Warrior or Card Name Warrior" (Taivas): the card satisfies at
   * least ONE member. Members are definition-only (`DefFilter`), so a disjunction never reads the state; an empty list
   * matches nothing. Conjoins with the other axes like any axis.
   */
  readonly anyOf?: readonly DefFilter[]
  /** Any ONE of these Elements. What `sameElementAsChosen` resolves to; an empty list matches nothing. */
  readonly elementIn?: readonly Element[]
  /**
   * "of the same Element as the chosen Character" (Luso 23-130H). NEVER read by a filter: the executor RESOLVES it into
   * `elementIn` (the first chosen card's printed Elements) where it builds candidates or raises a pending, so a pending
   * that travels into the search carries only world-independent axes. Asked unresolved, a filter THROWS — it must never
   * fail open and hand a search the whole deck. Game creation admits it only where a choice has already bound a card.
   */
  readonly sameElementAsChosen?: true
}

/**
 * Where each axis is answered (rung J5-D3): `def` axes read the printing alone (`matchesDefFilter`, which the
 * ISMCTS decoder may ask of a view); `instance` axes need the state (`matchesFilter`). Typed over EVERY key
 * of `TargetFilter`, so an axis added without a home fails to compile; `target-filters.test.ts` exercises
 * each by name, so an axis added without a test fails there. `resolved` (rung V1-A3, R1) is an axis the executor
 * replaces before any filter runs; a filter asked it throws.
 */
export const FILTER_AXES: Record<keyof TargetFilter, 'def' | 'instance' | 'resolved'> = {
  type: 'def', types: 'def', element: 'def', maxCost: 'def', cost: 'def',
  job: 'def', category: 'def', name: 'def', keyword: 'def', anyOf: 'def', elementIn: 'def',
  excludeSource: 'instance', excludeSourceName: 'instance', putIntoBreakZoneFromFieldThisTurn: 'instance',
  minPower: 'instance', maxPower: 'instance', status: 'instance', grantedKeyword: 'instance',
  sameElementAsChosen: 'resolved',
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
 * is what lets Shantotto raise a mode choice whose chosen branch then raises a target choice; an `if` branch
 * may hold either (rung V1-A1).
 */
export type Effect =
  /** Choose `min..max` targets, then run `then` once with `chosen` bound to them. min 0 = "up to". */
  | {
      readonly kind: 'chooseTargets'; readonly min: number; readonly max: number; readonly from: TargetSpec; readonly then: readonly Effect[]
      /**
       * A SELECT, not a choice (rung V1-A2, spec V1-D9): §11.3.3 "'To select' something is not equivalent to 'to
       * choose' something". Absent is a printed "choose". A select is made as the ability RESOLVES — the declare
       * stage ends at it like any non-choice — by the ability's controller (`self`: "you may put / play / discard")
       * or by that player's opponent (`opponent`: Alphinaud's "your opponent selects"). `from` stays relative to
       * the ability's controller either way. It never triggers "when chosen" (Prishe), never makes a Summon
       * uncastable, and with nothing to select it does nothing, silently — it is not a failed choice.
       */
      readonly select?: 'self' | 'opponent'
      /**
       * "When you do so, …" (rung V1-A2, spec V1-D10): `then` is skipped when the answer is empty. Without it `then`
       * runs on zero picks, which the existing "up to" shapes rely on. Since rung V1-D the "when you do so" clause itself
       * is a separate `reflexive` ability that `then` fires with `triggerReflexive` — its own stack item (Vincent).
       */
      readonly onlyIfChosen?: true
    }
  /** Choose `min..max` of `modes` ("select up to 2 of the 3 following"); chosen modes run in listed order. */
  | { readonly kind: 'chooseModes'; readonly min: number; readonly max: number; readonly modes: readonly AbilityMode[] }
  /** Run `do` once per card matching `from`, with `chosen` bound to that one card. Untargeted — no choice. */
  | { readonly kind: 'forEach'; readonly from: TargetSpec; readonly do: readonly Effect[] }
  | { readonly kind: 'dull' }
  /** "Freeze it" (§15.2.4, rung J3): the card skips its controller's next Active Phase. Does not dull. */
  | { readonly kind: 'freeze' }
  | { readonly kind: 'damage'; readonly amount: Amount }
  | { readonly kind: 'breakCard' }
  /**
   * "Put it into the Break Zone" (rung V1-A2, spec V1-D8) — Alphinaud, Ultima Weapon, Vincent. A zone movement from
   * the field to the OWNER's Break Zone, NOT a break (§15.1.1.3.2): `cannotBeBroken` does not stop it and there is
   * no `broken` event, but watchers of "put from the field into the Break Zone" see it and the LB sweep applies.
   */
  | { readonly kind: 'putIntoBreakZone' }
  /** "Activate it" (rung V1-A2, §15.1.1.1): a dull Character turns active; activating an active one is legal and does nothing. */
  | { readonly kind: 'activate' }
  /** "Discard it" (rung V1-A2, §15.1.1.4): each chosen card still in its owner's hand goes to that player's Break Zone. */
  | { readonly kind: 'discard' }
  /**
   * "Play it onto the field" from hand (rung V1-A2, spec V1-D11) — Yuna, Taivas. Not a cast (§15.1.1.7): no cost, no
   * `cast` event. The card leaves its owner's hand and enters through `putOntoField`, so its own enters-the-field
   * clauses and every watcher fire exactly as for Hugh Yurg's search. Field limits are the rule processes' (§7.7.4:
   * a sixth Backup is put into the Break Zone by §12.4.8), as for every entry by effect. A non-Character is skipped;
   * game creation refuses a filter that could admit a Summon.
   */
  | { readonly kind: 'playOntoField' }
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
      /**
       * Rung V1-E (E-D5): a SEARCH reveals what it finds (§15.1.1.8.1) — the look stays private (`audience: 'self'`), and
       * each TAKEN card is revealed to both players as it goes to hand, and stays known there. `audience: 'all'` is the
       * other shape, revealing everything looked at (Miner). Only with `to: 'hand'` (a card put onto the field is public
       * already); game creation refuses it elsewhere.
       */
      readonly revealTaken?: true
    }
  /**
   * Act on the card the TRIGGER EVENT is about — Luso's "break **it**" (spec C2-5). Binds `chosen` to the
   * event's subject and runs `do`, so every existing effect works on it unchanged. Deliberately NOT a target
   * choice: "it" is named by the printed text, and offering it as a choice would let the player retarget a
   * printed effect. A no-op when the frame has no trigger event, or the subject is not a card.
   */
  | { readonly kind: 'onSubject'; readonly do: readonly Effect[] }
  /**
   * Act on the ability's own SOURCE — "<this card> gains +2000 power and Brave" (rung V1-A4, spec V1-B R1: Jecht
   * 18-129C, LB Luso 23-130H). `onSubject`'s sibling: binds `chosen` to the source and runs `do`, so every existing
   * effect works on it unchanged. Not a choice (§11.6.5 is about choosing; the printed text names the card), so it is
   * never declared, never seen by a "when chosen" watcher, and `do` may not suspend. A source no longer on the field
   * (§11.11.7) is bound all the same; the field effects on it are then no-ops.
   */
  | { readonly kind: 'onSource'; readonly do: readonly Effect[] }
  /**
   * "If <condition>, <then>. Otherwise, <else>." (rung V1-A1, spec V1-D6) — Palom's "if you control a Card Name
   * Porom Forward, deal it 8000 damage instead". Read at RESOLUTION, not declaration: an `if` is not a choice, so
   * the declare stage ends at it, and a chooser inside a branch raises its prompt as the item resolves.
   *
   * It owns TWO levels of the program counter, like `chooseModes`: the branch (0 = `then`, 1 = `else`), then the
   * index within it. The branch is fixed when it is first entered; a frame resuming from a prompt inside it never
   * re-reads the condition, which may no longer hold.
   */
  | { readonly kind: 'if'; readonly when: Condition; readonly then: readonly Effect[]; readonly else?: readonly Effect[] }
  /**
   * "When you do so, …" (rung V1-D, plan D-D2): fire the `reflexive` clause `abilityId` of this same card. It is
   * TRIGGERED here, with the running frame's source and controller and no trigger event, and does nothing more now:
   * like any trigger it is placed at the next priority grant (§11.8.7) — its own stack item, its choices declared as it
   * is placed (§11.8.4 applies), resolved after a window. The official ruling of 2019-07-19 (Fusilier 9-013C): the
   * follow-up goes on the stack after the first part resolves, and players may respond. Not a choice; never suspends.
   */
  | { readonly kind: 'triggerReflexive'; readonly abilityId: string }

/**
 * How much (rung V1-A1, spec V1-D7): a printed number, or "N for each <filter> Character <side> controls" — Zack's
 * "1000 damage for each Backup you control". `per.controller` is relative to the ability's controller and
 * `per.filter` is definition-only, counted by the same `countControlled` as `controlsAtLeast`.
 *
 * Counted as each hit resolves. Within one frame nothing leaves the field by damage — breaks are rule processes
 * run between frames (§12.4.5) — so every hit of one sweep reads the same count. A clause whose own effects move
 * counted cards mid-sweep would need the count fixed first; none does.
 */
export type Amount = number | { readonly per: { readonly controller: 'self' | 'opponent'; readonly filter?: DefFilter }; readonly times: number }

/**
 * What an `if` tests (rung V1-A1, spec V1-D6): any static condition, read for the ability's controller, or a fact
 * about the frame's current subject — Porom's "if the discarded card is Category IV" reads the card just chosen.
 */
export type Condition =
  | StaticCondition
  /**
   * The frame's first chosen card matches `filter`, wherever that card now is — field, hand or Break Zone — since a
   * clause may test the card it has just moved. A `TargetFilter`, read through `matchesFilter` at resolution: an
   * instance axis here reads the state once, not the layer continuously, so it cannot loop. False with no subject.
   */
  | { readonly kind: 'subjectMatches'; readonly filter: TargetFilter }

/**
 * Until-end-of-turn protections that `granted: Keyword[]` cannot express (spec C1-7).
 *
 * `cannotBeReturnedByOpponent` is granted, rendered and tested, but NOTHING CONSULTS IT YET (spec C5-4):
 * every `moveToHand` in the pool targets the Break Zone, so no effect returns a Forward from the field to
 * hand. It exists because it is half of Cloud's printed clause, and it gets its enforcement point and its
 * test the day a return effect arrives — until then it must not be described as protecting anything.
 */
/*
 * `cannotUseActionAbilities` (rung V1-A3, spec V1-D15) is Charlotte's "Forwards your opponent controls cannot use action
 * abilities", granted continuously by a `grantFlag` static and read by `activationCheck`. An action ability (§11.6) only:
 * a special ability (§11.7) is not one, and stays usable.
 */
export const FIELD_FLAGS = ['cannotBeBroken', 'cannotBeReturnedByOpponent', 'cannotUseActionAbilities'] as const
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
  | { readonly kind: 'observesEnterField'; readonly whose: TriggerWhose; readonly of: CardType | readonly CardType[]; readonly filter?: TargetFilter }
  /**
   * The beginning of the Attack Phase, on the CONTROLLER's own turn (spec C5-2). Cloud prints "during each of
   * your turns", and that restriction lives in the dispatch rather than on the card: a clause that fired on
   * the opponent's turn too would hand them a free protection every round, which one Cloud on one side of a
   * fixture cannot detect.
   */
  | { readonly kind: 'attackPhaseBegins' }
  /**
   * "When <this> attacks" (rung V1-A1, spec V1-D5). Fires the moment THIS Forward is declared an attacker —
   * §10.1.2.4 makes it "an attacking Forward" — and §10.1.2.5 puts the clause on the stack before the turn player
   * gains priority in the `declared` window (§10.1.2.6). A party places one per member that carries it, each
   * with that member as its source; the controller is the turn player, who declared the attack.
   */
  | { readonly kind: 'attacks' }
  /**
   * "When you do so, …" (rung V1-D, plan D-D2): an auto-ability whose trigger event is its own card's effect having been
   * done — Vincent's 9000 after the Fire Backup is put. No dispatcher fires it on its own; only a `triggerReflexive`
   * effect in a clause of the same card does. Game creation refuses a `triggerReflexive` naming anything else, and a
   * reflexive clause that fires one (which the AI's pricing would otherwise follow forever).
   */
  | { readonly kind: 'reflexive' }
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
      /** "You can only use this ability during your turn" (Sphene). Since J1 abilities are instant speed, so
       *  the restriction is the card's own; `activationCheck` enforces it. */
      readonly yourTurnOnly?: boolean
      /**
       * A SPECIAL ability (§11.7, rung V1-A3, spec V1-D13), with its proper name — Jecht's "Jecht Beam". Activated as an
       * action ability is (§11.7.1), and its cost carries `discardSameName`. Not an ACTION ability (§11.6 vs §11.7), so
       * "cannot use action abilities" does not reach it.
       */
      readonly special?: { readonly name: string }
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
/**
 * The definition axes of `TargetFilter` (rung J5) — the only ones a CONTINUOUS effect's scope may use.
 *
 * MVP0-SIMPLIFICATION (§11.12.4.12–13, rung J6-D2): an instance axis here (effective power, a granted keyword,
 * status) would make the continuous-effect layer read its own output — dependency between ongoing effects,
 * which the CR orders by dependence then timestamp. Every layer member today is additive, so the order is
 * unobservable; the day a non-additive or instance-scoped effect lands, fixed-point semantics go here.
 */
export type DefFilter = Pick<TargetFilter, 'type' | 'types' | 'element' | 'cost' | 'maxCost' | 'job' | 'category' | 'name' | 'keyword' | 'anyOf' | 'elementIn'>

/**
 * Whom a continuous effect reaches (rung J6-D2): the existing targeting vocabulary — `controller` is relative
 * to the SOURCE's controller, `excludeSource` is "other than this card", `filter` is definition-only.
 */
export interface StaticScope {
  readonly controller: TargetController
  readonly excludeSource?: boolean
  readonly filter?: DefFilter
  /**
   * "<this card> gains …" (rung V1-A1, spec V1-D6): the source alone. A name filter would say the wrong thing —
   * LB Zack 22-112R shares Zack 27-123S's name, and Zack's Haste is his own, not every Zack's.
   */
  readonly self?: true
}

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
   * "You can only pay with <Element> CP to cast <this card>" — Ward 21-001R (rung V1-A3, spec V1-D14). Like
   * `costReduction`, read off the card's OWN abilities wherever it is cast from, by `castRequirement`, into
   * `CpRequirement.onlyElement`; every payment reader then counts only CP that can be that Element toward the cost. CP
   * of another Element may still be generated and go unspent (§11.2.2.3; rung V1-D reversed the V1-A3 reading).
   */
  | { readonly kind: 'onlyCp'; readonly element: Element }
  // --- rung J6: CONTINUOUS field effects (§11.12.4.4–5), applied by the layer while the source is on the field ---
  /** "Forwards you control gain +N power" — read by `effectivePower` through the layer. */
  | { readonly kind: 'modifyPower'; readonly amount: number; readonly to: StaticScope; readonly when?: StaticCondition }
  /** "Your Forwards gain Haste" — read by `keywordsOf`. */
  | { readonly kind: 'grantKeyword'; readonly keyword: Keyword; readonly to: StaticScope; readonly when?: StaticCondition }
  /** "Your Forwards cannot be broken" — read by `flagsOf`. */
  | { readonly kind: 'grantFlag'; readonly flag: FieldFlag; readonly to: StaticScope; readonly when?: StaticCondition }
  /**
   * A damage-modifying REPLACEMENT effect (§11.12.5, rung V2-A2, plan A2-D1): "If <a Forward> is dealt damage, reduce the
   * damage by N instead" (Charlotte, Yuzuki), "… the damage becomes 0 instead" (Yuzuki), "If a Forward you control deals
   * damage to a Forward, the damage increases by N instead" (Wuk Lamat). Not a continuous effect: it changes a damage
   * EVENT, so it is read only by `damage.ts`'s collector, from a source on the FIELD. `id` names it in an order prompt.
   */
  | { readonly kind: 'damageReplacement'; readonly id: string; readonly affects: DamageScope; readonly change: DamageChange; readonly when?: StaticCondition }

/**
 * What a damage replacement does to the running amount (§4.3, plan A2-D3): add, subtract, or set it to 0. `add` and
 * `reduce` are positive whole numbers (validated at game creation).
 */
export type DamageChange = { readonly add: number } | { readonly reduce: number } | { readonly becomes: 0 }

/**
 * Which damage a replacement waits for (rung V2-A2, plan A2-D1), relative to the controller of the card carrying it.
 * `target` is the damaged Forward: the source itself (`self`, Charlotte), or a Forward of `controller` matching a
 * definition-only `filter` (Yuzuki's "a Water Forward you control"; Wuk Lamat's "a Forward" is `any`). The rest narrow
 * the DAMAGE: `byCause: 'ability'` is an ability's damage, never a Summon's (spec V2-D6); `byController: 'opponent'` is
 * dealt by the opponent; `bySource` requires EVERY dealer of the packet to be a card of `controller` matching `filter`
 * (plan R8 — Wuk Lamat's "a Forward you control deals damage").
 */
export interface DamageScope {
  readonly target: 'self' | { readonly controller: 'self' | 'any'; readonly filter?: DefFilter }
  readonly byCause?: 'ability'
  readonly byController?: 'opponent'
  readonly bySource?: { readonly controller: 'self'; readonly filter: DefFilter }
}

/** The continuous kinds — what `layer.ts` indexes; `costReduction`, `produceElement` and `onlyCp` keep their own readers. */
export const CONTINUOUS_STATIC_KINDS = ['modifyPower', 'grantKeyword', 'grantFlag'] as const
export type ContinuousStatic = Extract<StaticEffect, { kind: (typeof CONTINUOUS_STATIC_KINDS)[number] }>

/**
 * When a static applies. Plain data, never a predicate function: card definitions travel through
 * `structuredClone` into the search and into the Web Worker, which strips functions — the same constraint
 * that made the whole ability system an AST.
 */
export type StaticCondition =
  /** "If you have received N points of damage or more" — the CASTER's damage zone (§9.4). */
  | { readonly kind: 'damageReceived'; readonly atLeast: number }
  /**
   * "If you control / your opponent controls N or more <filter> Characters" (rung V1-A1, spec V1-D6). Counts the
   * Forwards and Backups on that player's field — `controller` is relative to the controller of the ability —
   * matching `filter` by DEFINITION only: read by a static `when`, an instance axis would make the layer read
   * its own output. No filter is any Character.
   */
  | { readonly kind: 'controlsAtLeast'; readonly count: number; readonly controller: 'self' | 'opponent'; readonly filter?: DefFilter }

/**
 * Does an observer's `of` admit a card of `type`? One type, or several (rung V1-A5): LB Luso 23-130H watches "a Job
 * Standard Unit", and a Standard Unit may be a Forward (Dragoon 1-147C) or a Backup (Geomancer 18-064C).
 */
export function observesType(of: CardType | readonly CardType[], type: CardType | undefined): boolean {
  return type !== undefined && (typeof of === 'string' ? of === type : of.includes(type))
}

export type ActivationSourceZone = 'field' | 'hand' | 'breakZone'

/**
 * Mirrors `ZoneTransition.reason` (rules.ts); declared here so the trigger event can carry it without a cycle.
 * `ability` is an ability BREAK (`breakCard`); `putByAbility` is an effect that says "put into the Break Zone" (rung
 * V1-A2), which is not a break (§15.1.1.3.2) — kept apart so nothing reading "was broken" off `ability` miscounts it.
 */
export type ZoneTransitionReason = 'zeroPower' | 'damage' | 'ability' | 'putByAbility' | 'cost' | 'sameName' | 'lightDark' | 'backupLimit'

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
   * §11.7.1 (rung V1-A3): a special ability's "discard a card with the same name" — one OTHER card from hand whose name
   * is the source's. WHICH card is part of the payment (`Payment.sameName`); `legalCommands` lists one canonical choice
   * (the first in hand order) and `isLegal`/`apply` accept any card that qualifies.
   */
  readonly discardSameName?: true
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
  /** A card was CHOSEN by a Summon or ability as its choice was declared (rung J1-D7, spec C11). */
  | { readonly kind: 'chosen'; readonly card: CardId; readonly by: CardId; readonly byController: PlayerId }

export interface Ability {
  /**
   * Stable per-clause id, `<card code>:<slug>` (e.g. `16-092C:etb`). Coverage is tracked per CLAUSE, not
   * per card (spec C1-9): no card in this pool is wholly inside one rung, so a card keeps emitting
   * `unimplementedAbility` for the clauses that are still unimplemented even after this one lands.
   */
  readonly id: string
  readonly trigger: AbilityTrigger
  /**
   * A CONDITIONAL auto-ability (§11.8.13, rung V1-D): "(trigger), if (condition), (effect)" — Ultima Weapon's "When …
   * enters the field, if you control 4 or more Water Characters, …". Read for the source's controller as the event
   * happens (`enqueueTrigger`): false, the clause does not trigger at all. Read again as the item starts resolving
   * (§11.11.3): false then, it is removed from the stack and does nothing (`stackCancelled`, reason `condition`).
   * Only an auto-ability triggers, so game creation refuses it on an activated or a static ability. An effect-level
   * "If …" after a choice (Ultima Weapon's Fire clause) is an `if` effect, not this.
   */
  readonly triggerIf?: StaticCondition
  /** The printed wording this AST encodes, quoted verbatim. Reviewers check the AST against THIS. */
  readonly text: string
  readonly effects: readonly Effect[]
  /**
   * Rung G3: this is the clause the printed EX BURST tag prefixes, so it also fires when the card is dealt as
   * damage (§11.10).
   *
   * A FLAG rather than a match on `text`. The tag is quoted at the front of the wording of every clause that
   * carries it, so `text.startsWith('EX BURST')` would work today and would silently start mis-triggering the
   * moment someone rewords a comment. It also lets the pool check assert that each `def.exBurst` card marks
   * exactly one clause — a card printing EX BURST with no marked clause is a coverage hole that nothing else
   * would notice.
   */
  readonly exBurst?: boolean
}

// ---------------------------------------------------------------------------
// Resolution agenda (spec C1-3)
// ---------------------------------------------------------------------------

/**
 * A suspended ability in mid-execution. `path` is the program counter: an index per nesting level, so a
 * frame can resume inside `then`/`modes`/`do`/an `if` branch after a player answers. `chosen` is the target binding the
 * innermost `chooseTargets`/`forEach` established.
 */
/**
 * MVP0-SIMPLIFICATION (§11.11.4, §11.11.7, rung J1-D16): a frame carries no snapshot of its source. A source that leaves
 * the field before its item resolves reads nothing of its former self ("last-known information"). No pool
 * clause reads its source's characteristics at resolution, so this is unobservable today.
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
   * What fired this clause, for `onSubject` and for narration. Null for `enterField`/`summonResolve`/`attacks`,
   * which are about the source itself, and for `reflexive` (rung V1-D), fired by the source's own effect. It must survive prompts and the source leaving the field (spec C2-5).
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
   * both as "activates" and as "triggers" in the same breath. G3 adds `exBurst` for the same reason: a burst
   * is not an ordinary trigger, it does not use the stack, and narrating it as one would be a third wording
   * for a thing the player deliberately chose.
   */
  readonly origin?: 'triggered' | 'activated' | 'exBurst'
  /**
   * Rung J1. `declare` while the frame's choices are being made as it is PUT ON the stack (§11.3.3–4,
   * §11.6.5–6, §11.8.9–10); `resolve` (or absent) while it executes. In the declare stage only choice nodes
   * run; their answers land in `modes` and `declared`.
   */
  readonly stage?: 'declare' | 'resolve'
  /** Targets declared at placement, by the path of the `chooseTargets` node they answer; re-validated at resolution (§11.11.2). */
  readonly declared?: readonly { readonly path: readonly number[]; readonly targets: readonly CardId[] }[]
  /** True once `modes` was declared at placement (it may legitimately be empty: "up to 2" can choose none). */
  readonly modesDeclared?: boolean
}

/**
 * Work the engine owes itself. `pending` stays exactly what it always was — the ONE decision a player
 * currently owes — and is cleared before the agenda resumes; this is the queue behind it.
 */
export interface Resolution {
  /** The frame currently executing — declaring as it is put on the stack, or resolving — if any. Corresponds 1:1 with a non-null ability `pending`. */
  readonly active: Frame | null
  /**
   * Rung J1-D2: clauses that have TRIGGERED and are not yet placed on the stack, in trigger order. They do
   * nothing until a player would gain priority (§11.8.7), when `settle` places them — the turn player's
   * first — declaring each one's choices as it goes.
   */
  readonly queue: readonly Frame[]
  /**
   * The stack item being built while its frames declare (rung J1-D3): the item goes onto the stack when the
   * last of them finishes declaring. `frameIndex` is which of `item`'s frames `active` is.
   */
  readonly placing: { readonly item: StackItem; readonly frameIndex: number } | null
  /** Which frame of the TOP stack item is resolving (rung J1-D9), or null when nothing on the stack is. */
  readonly resolvingFrame: number | null
  /**
   * Total effect steps spent, across the WHOLE agenda and PERSISTING across player choices (spec C1-5).
   * A call-depth cap would not catch a trigger cycle that launders itself through a `chooseTargets`
   * prompt. Exceeding `MAX_RESOLUTION_STEPS` throws loudly rather than hanging the browser.
   */
  readonly steps: number
}

export const MAX_RESOLUTION_STEPS = 512

export const EMPTY_RESOLUTION: Resolution = { active: null, queue: [], placing: null, resolvingFrame: null, steps: 0 }

/**
 * Does the agenda still owe the engine anything WITHOUT a player forfeiting priority? An active frame, a
 * triggered clause not yet placed, an item mid-placement, or a stack item mid-resolution. What is on the
 * stack and waiting is NOT counted: that resolves only when both players pass (§11.1.7), and a settlement
 * that stopped there is complete. `hasStackWork` on the state is the other question.
 */
export function hasResolutionWork(r: Resolution): boolean {
  return r.active !== null || r.queue.length > 0 || r.placing !== null || r.resolvingFrame !== null
}

/**
 * The printed cost, rendered the way the card prints it — `[Lightning][Dull]`, `[2][Dull], put into the Break
 * Zone`. Lives here so the CLI and the browser cannot drift into describing the same ability differently.
 *
 * `sourceName` names the card a special ability's same-name discard takes (rung V1-A3, R9): "discard Jecht". The S
 * icon itself is not rendered — it IS that discard (§11.7.1), and a caller names the ability by its proper name.
 */
export function describeAbilityCost(cost: AbilityCost, sourceName?: string): string {
  // Icons run together and prose is comma-separated, because that is how the cards print it:
  // `[2][Dull], put Miner into the Break Zone` — never `[2], [Dull], put ...`.
  let icons = ''
  if (cost.cp) {
    const els = cost.cp.requiredElements ?? []
    // A required Element prints as its own icon; a generic cost prints as the number. Both at once print both, the
    // Elements first: Warrior 11-010C's `[Fire][1]` is two CP, one of them Fire (rung V1-B review).
    const generic = cost.cp.amount - els.length
    icons += els.length
      ? els.map((e) => `[${e[0]?.toUpperCase()}${e.slice(1)}]`).join('') + (generic > 0 ? `[${generic}]` : '')
      : `[${cost.cp.amount}]`
  }
  if (cost.dull) icons += '[Dull]'
  const prose: string[] = []
  if (cost.selfToBreakZone) prose.push('put into the Break Zone')
  if (cost.selfDiscard) prose.push('discard')
  if (cost.selfRemoveFromGame) prose.push('remove from the game')
  if (cost.discardSameName) prose.push(sourceName === undefined ? 'discard a card with the same name' : `discard ${sourceName}`)
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
    if (eff.kind === 'if') {
      // `if` owns TWO levels too: the branch taken (0 = then, 1 = else), then the index within it (rung V1-A1).
      const k = path[depth + 1]
      const branch = k === 0 ? eff.then : k === 1 ? eff.else : undefined
      return branch ? walk(branch, depth + 2) : null
    }
    return null
  }
  return walk(effects, 0)
}

/**
 * How many of a card's PRINTED clauses this build does not implement — the number the game log's
 * "played as vanilla" warning is derived from (spec C1-9).
 *
 * One implementation, consumed by `warnUnimplemented` and by the browser's card details panel. They must
 * agree: the panel exists to tell the player which printed text the engine will not honour, and the log
 * tells them the same thing at cast time. Two copies of this arithmetic would be two stories about one
 * card, which is a worse drift than the one rung E2 removed.
 *
 * The clamp is load-bearing, not defensive tidiness. `abilityClauses` is a hand-maintained count of what
 * the card PRINTS and `abilities` is the hand-written AST; a card whose AST splits one printed clause into
 * two would otherwise report a negative number of missing clauses, and every caller here treats "> 0" as
 * "warn the player".
 */
export function unimplementedClauseCount(def: CardDef): number {
  const printed = def.abilityClauses ?? (def.hasAbilities ? 1 : 0)
  const implemented = def.abilities?.length ?? 0
  // `inertClauses` are unimplemented AND unreachable in this pool, so they are not missing in any sense the
  // player can observe — see `CardDef.inertClauses` and the proof obligation the cards package carries.
  return Math.max(0, printed - implemented - (def.inertClauses ?? 0))
}
