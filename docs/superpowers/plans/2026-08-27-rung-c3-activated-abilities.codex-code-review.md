Reading additional input from stdin...
OpenAI Codex v0.146.0
--------
workdir: /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: read-only
reasoning effort: xhigh
reasoning summaries: none
session id: 01a04286-06bf-7d72-a337-2893729926b1
--------
user
Adversarial CODE review of an implemented rung, against its own spec. TypeScript pnpm monorepo implementing
a subset of the Final Fantasy TCG (Comprehensive Rules 3.3): a rules engine, a heuristic agent, an SO-ISMCTS
search, and a React browser app that plays the search in a Web Worker.

You plan-reviewed this spec and found five blockers; revision 2 records them. This is the implementation.

READ FIRST:
- `docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md` — the spec (revision 2).
- `docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md` — your own plan review.
- The implementation: `packages/engine/src/activate.ts` (the transaction), `packages/engine/src/cp.ts`
  (generalized CP + source exclusion), `packages/engine/src/draw.ts`, `packages/engine/src/abilities.ts`
  (the `activated` trigger variant, `AbilityCost`, `describeAbilityCost`, the `draw` effect),
  `packages/engine/src/commands.ts`, `packages/engine/src/legal.ts` (`activationsFor`),
  `packages/engine/src/apply.ts`, `packages/engine/src/rules.ts` + `resolve.ts` (`reason: 'cost'`).
- The cards: `packages/cards/src/abilities.ts` — the six new clause ASTs and `ABILITIES`/`ABILITY_CLAUSES`.
- The AI: `packages/ai/src/candidates.ts` (`activationCandidates`), `packages/ai/src/payment.ts`
  (`preferredPaymentFor`), `packages/ai/src/evaluate.ts` (the new `temporaryPower` weight),
  `packages/ai/src/ismcts/keys.ts` (encode/decode).
- The browser: `apps/web/src/game/commands.ts` (`preferredChoices` payment collapsing, `describeChoice`,
  `subjectsOf`, `sameCommand`, `describeTriggerCause`), `apps/web/src/game/useGame.ts` (narration).
- Tests: `packages/engine/test/activated-abilities.test.ts`, `packages/ai/test/greedy.test.ts` (the
  `temporaryPower` block), `apps/web/test/commands.test.ts` (the C3-A7 block), `apps/cli/test/agents.test.ts`
  (the C3-A1 block).

Diff to review: the four most recent commits on branch `worktree-rung-d2-worker` (70707c0, dadf42b, 56151cb,
eee7eab).

DESIGN CHOICE I MADE AGAINST YOUR RECOMMENDATION, and want you to attack:
you said to put `targets` on the `activateAbility` command. I did NOT. Instead activation PREFLIGHTS the
ability's first `chooseTargets` against the state as it will be once costs are paid, and target choice stays a
separate `Pending` exactly as it is for every triggered ability. My reasoning: it prevents the same bug, it
makes "the source cannot target itself" fall out for free, and the candidate set the player is then offered is
by construction the one that was preflighted. Tell me where that is wrong — in particular whether an ability
whose targeting is NOT its first effect, or which has several `chooseTargets`, breaks it.

WHAT I WANT, concrete, with `path:line`:

1. **The activation transaction.** Enumerate any interleaving of cost payment, cost-fired triggers, the action
   frame, rule processes (`settle`) and an existing `Pending` that produces: a cost paid with no effect, an
   effect with no cost, a trigger resolving in the wrong order, or a frame whose source no longer exists being
   read. Is `activationCheck` genuinely identical to what `apply` enforces?

2. **The CP generalization.** Is `generateCp`'s `excluded` list correct and complete? Does
   `enumeratePaymentsFor` still emit exactly the MINIMAL payments, and does `preferredPaymentFor` still return
   one that is IN that set? (A previous rung had a bug where 40% of preferred payments were not in
   `legalCommands` at all.) Anything wrong with `[0]` costs, or with a required Element the player cannot make?

3. **`reason: 'cost'`.** Is the not-a-break/still-a-movement distinction implemented consistently everywhere —
   `rules.ts`, `resolve.ts`, the trigger event, the log? Should anything else filter on it that does not?

4. **The six ASTs** against their printed text (quoted in each `text` field). Any wrong, over-broad or
   over-narrow target specs? Is Noel's `forEach` right for "all the Forwards opponent controls"?

5. **The AI.** Does `activationCandidates` mirror `activationsFor` closely enough that the agent never
   proposes something `apply` rejects? Are the ISMCTS action keys world-independent (`abilityId` is a printed
   identity, but the source and payment are card ids)? Is `temporaryPower` sound — I measured new-vs-old greedy
   at 50.5% over 800 games, i.e. NO measurable difference, and kept it as a correctness fix only.

6. **What is missing or over-built**, and what should C4 do first (the two deferred clauses are Undead
   Princess's remove-from-game and Sphene's once-per-turn `[0]`).

FORMAT: `## HIGH`, `## MEDIUM`, `## LOW`, then `## WHAT I WOULD DO DIFFERENTLY`. Each item: bold one-line
claim, evidence with `path:line`, concrete **Fix:**. Do not pad — if something is sound, one line and move on.
codex
I’ll trace the spec invariants into the transaction, payment enumeration, resolution ordering, cards, AI, and browser/tests. I’ll keep the output to actionable findings with exact line references, and explicitly stress-test the preflight-targeting design.
  → Read revision-2 spec and prior plan review; extract required invariants
  • Trace engine transaction, CP enumeration, cost movement, and activation legality
  • Audit six card ASTs, AI candidates/keys/evaluation, browser handling, and tests
  • Run focused tests and adversarial checks, then report only evidenced findings
exec
/bin/zsh -lc 'wc -l docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md && git status --short && git log --oneline -8' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     122 docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md
   20033 docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md
   20155 total
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-0wCYMBfe' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-CzI3WGRS' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-IeAaA7a3' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-45fbdTXT' (errno=Operation not permitted)
eee7eab fix(ai): power that expires is not worth the same as power a card has
56151cb feat(web): rung C3 stage 3 — activations are usable, and narrated as activations
dadf42b feat(cards): rung C3 stage 2 — six activated clauses, and the AI actually uses them
70707c0 feat(engine): rung C3 stage 1 — the activated-ability substrate
6f86fde docs(engine): rung C3 spec revision 2 — after a plan review that found five blockers
f58b050 docs(engine): reorder the ability rungs — activated abilities before deck knowledge
f9c2c29 docs(engine): rung C3 spec — the deck information model
b4b0981 docs(web): archive the Codex D2 code review

exec
/bin/zsh -lc "wc -c docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md && nl -ba docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md && rg -n '"'^#{1,4} |''^'"\\*\\*|Blocker|BLOCKER|targets|preflight|activation' docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md | head -240" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
 1621577 docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md
     1	# Rung C3 — Activated abilities: giving the player something to *do* with the board
     2	
     3	> Revision 2 (2026-08-27), after a Codex plan-review that found five blockers, three of which were my own
     4	> errors and one of which was a flat self-contradiction. The review is
     5	> `docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md`. This rung replaced a
     6	> planned deck-knowledge rung; that reasoning is at the top of `2026-08-27-rung-c6-deck-knowledge.md`, and the
     7	> review independently confirmed the reordering was right.
     8	
     9	## Context
    10	
    11	Ten of the starter deck's 28 printed clauses work. Every one is **triggered** — something happens to a card
    12	and the ability fires. The player never chooses to use an ability, because there is no way to: the `Command`
    13	union has casts, attacks, blocks and the answer commands, and **nothing for activating an ability**
    14	(`packages/engine/src/commands.ts:5`).
    15	
    16	That gap blocks eight clauses. This rung takes **six** of them:
    17	
    18	| Card | Clause | Cost | Source zone |
    19	|---|---|---|---|
    20	| Red Mage (1-121C) | Choose 1 Forward, it gains Haste | `[Lightning]` + `[Dull]` | field |
    21	| Noel (16-092C) | Dull all Forwards opponent controls | `[Dull]` + put into Break Zone | field |
    22	| Miner (20-074C) | Draw 1 | `[2]` + `[Dull]` + put into Break Zone | field |
    23	| Undead Princess (19-052C) | Choose 1 Forward, +4000 | put into Break Zone | field |
    24	| Geomancer (18-064C) | Draw 1 | `[Earth]` + discard itself | **hand** |
    25	| Red Mage (18-069C) | Draw 1 | `[Lightning]` + discard itself | **hand** |
    26	
    27	**This is the rung a human notices.** Ten triggered clauses make a board that happens to you; activated
    28	abilities are the first thing that makes it a board you *use*.
    29	
    30	The two hand-sourced Backups are in on the review's recommendation, and they earn their place: they force
    31	`sourceZone` to be real rather than speculative, and they cost almost nothing extra once Miner has already
    32	forced a `draw` effect and generalized CP. Left for C4: Undead Princess's second clause (needs a
    33	removed-from-game zone) and Sphene's `[0]` (needs field→Break-Zone history and once-per-turn state).
    34	
    35	**Correction to revision 1's framing.** It said "eight clauses behind one primitive", which undersold this.
    36	Activation also needs target declaration, generalized costs, a draw effect, command codecs, AI enumeration and
    37	a timing policy. The reordering is still right — the review agreed, because none of that entangles
    38	determinisation with private information the way rung C6 does — but this is a substrate, not a one-liner.
    39	
    40	## Decisions
    41	
    42	| # | Decision | Ruling (and why) |
    43	|---|---|---|
    44	| C3-1 | **`activateAbility { player, source, abilityId, payment, targets }`** | Targets are declared **with** the activation, not discovered after the frame starts. `resolve.ts:235` treats an empty target set as a successful no-op, which is right for a triggered ability and wrong here: it would let Undead Princess pay her whole cost — breaking herself — for nothing. Activation is one transaction: legal targets, or not legal at all. |
    45	| C3-2 | **`abilityId`, never an array index** | `Ability.id` already exists as a stable per-clause identity (`abilities.ts:121`). Indices would break precisely because of this rung's own ordering: Miner's action is its *second* printed clause but would sit at index 0 while its ETB is deferred to C6, then silently shift when C6 lands. |
    46	| C3-3 | **`sourceZone: 'field' \| 'hand' \| 'breakZone'` is first-class now** | An activation precondition, not a cost. Inferring "on the field" from the presence of a `[Dull]` cost would need replacing immediately for the two hand Backups and again for C4's Break-Zone clause. |
    47	| C3-4 | **Generalize the CP machinery, keep `Payment`** | `Payment` describes CP *sources* and is fine. What cannot be reused is the cast validator, which derives amount and elements from the card definition (`cast.ts:33`): Red Mage's ability costs `[Lightning]` = 1 Lightning while the card's printed cost is 2, and Miner's costs a generic `[2]` while the card is a 3. So: `{ amount, requiredElements: Element[], excludedSources: CardId[] }`, shared by casting, enumeration, `preferredPayment` and activation. `[0]` admits only the empty payment. |
    48	| C3-5 | **Exclusions apply to dulled Backups too, not only discards** | `generateCp` excludes `casting` in the discard loop and **not** in the Backup loop (`cp.ts:24`–`cp.ts:34`). Left alone, Red Mage would dull *itself* to make its own Lightning CP and pay its `[Dull]` cost with the same action — one dull, two costs. |
    49	| C3-6 | **`[Dull]` restrictions gate on the cost containing `[Dull]`** | Active status, entered-this-turn and the Haste exception apply only when the cost has the dull icon. Undead Princess's cost is *only* "put into the Break Zone", so she may activate **while dull and on the turn she enters** — revision 1's acceptance criterion said otherwise and was simply wrong. |
    50	| C3-7 | **A self-break cost is not a break, but it IS a zone movement** | Revision 1 contradicted itself here. The implemented observer's printed text is "is **put from the field into the Break Zone**" (`cards/src/abilities.ts:220`) and `watches` ignores the transition reason by design, so paying this cost **must** trigger Lightning. What must not be emitted is a `broken` / `brokenByAbility` / `breakPrevented` event, and `cannotBeBroken` must not prevent the payment. Add `ZoneTransition.reason: 'cost'` so a future "when broken" observer can filter, and fix `describeTriggerCause`, which currently narrates every zone move as "was broken" (`apps/web/src/game/commands.ts:60`). |
    51	| C3-8 | **Cost triggers are enqueued BEFORE the action frame** | `drainResolution` is FIFO (`resolve.ts:413`). An ability whose cost breaks its own source generates watcher triggers that must resolve *above* the action they paid for. "Pay, then push the frame" is only correct if the cost's transitions are handed to `enqueueZoneChangeTriggers` first. |
    52	| C3-9 | **Add `{ kind: 'draw'; count }` and move `drawCards` somewhere neutral** | Revision 1 claimed all four effect halves needed no new machinery. False: `Effect` has no draw, and the only draw primitive lives in `phases.ts`, which `resolve.ts` cannot import because `phases.ts` already imports `resolve.ts` (`phases.ts:8`). Extract `drawCards` — empty-deck loss semantics (§3.1.2) intact — into a module both can import. |
    53	| C3-10 | **The AI must be given activations explicitly** | Revision 1 said the AI gets them "for free" from `legalCommands`. It does not: `candidateCommands` hand-builds casts and `pass` in the Main Phases (`candidates.ts:295`) and the search enumerates *that* list. Activation needs its own emission (one preferred-payment activation per `(source, abilityId, target set)`), plus `ActionKey` encode/decode and the synthetic-id guard. |
    54	| C3-11 | **MVP0-SIMPLIFICATION: turn player, Main Phase 1 or 2 only — and this one costs something** | Revision 1 claimed this was "not a further loss of fidelity". Wrong: the CR allows action abilities in the Attack Phase too, and the engine even has an unblocked turn-player action point at attack declaration (`legal.ts:68`). Noel and Red Mage still work from Main 1 before attacking, but **Undead Princess stops being a combat trick** — she cannot pump after blockers are declared. Stated plainly as "action abilities are sorcery-speed", marked at the site, and listed in the README's deviations. |
    55	| C3-12 | Not in scope | Undead Princess's second clause and the removed-from-game zone; Sphene; EX Burst; static abilities (Class Tenth Moogle's CP, Odin's cost reduction, Sphene's protection); deck knowledge (C6). |
    56	
    57	## Rules citations
    58	
    59	Revision 1's citations were wrong (§1.3.3 and §9.3.2 name unrelated rules). Per the plan review the correct
    60	ones are: **§§11.6.3–11.6.11** activation procedure, **§11.6.10** cost atomicity, **§11.6.5** targeting at
    61	activation, **§11.5.4** source independence, **§11.6.2.2** the `[Dull]` control-since-start / Haste rule,
    62	**§15.1.1.3.2** putting into the Break Zone as a cost is not breaking, **§11.2.2.3** CP over-*generation*
    63	(not overpayment).
    64	
    65	**These are adopted from the review and are not independently verified here** — the Square Enix CDN that hosts
    66	the rules PDF IP-blocks this machine. They go into code comments as citations, so if any is wrong it will
    67	propagate; whoever can open the PDF should check them once.
    68	
    69	## What could go wrong, in the order it will bite
    70	
    71	- **The AI will misuse these, and the win-rate gate will not notice.** Two concrete, already-identifiable
    72	  errors rather than a vague worry: Backup status contributes nothing to material (`evaluate.ts:95`), so
    73	  dulling a CP Backup looks free; and losing an active 2000-power Undead Princess scores exactly the same as
    74	  giving another Forward +4000, with greedy keeping the earlier command on a tie (`greedy.ts:95`) — so it can
    75	  trade a body for a pump it never uses. Needs a small active-Backup/ready-CP term and a discount on
    76	  `powerBonus` that cannot affect combat before it expires, plus explicit "pass over the useless activation"
    77	  tests.
    78	- **Cost/effect atomicity.** Four of the six costs remove or dull the source; it is the normal case here, not
    79	  the exotic one. Any implementation that reads the source card while resolving the effect works for Red Mage
    80	  and breaks for Noel.
    81	- **The UI will show one button per payment.** `preferredChoices` collapses payment variants for casts only
    82	  (`apps/web/src/game/commands.ts:372`); Red Mage and Miner would otherwise expose every enumerated payment
    83	  as a separate choice. Casts and activations both need to be treated as "payable commands".
    84	
    85	## Acceptance criteria
    86	
    87	- **C3-A1 (reachability)** Every one of the six clauses is reachable from `legalCommands` **and** emitted by
    88	  `candidateCommands`, in a real driven game — the second half is the one revision 1 missed. Both agents must
    89	  be shown actually choosing an activation at least once.
    90	- **C3-A2 (atomicity)** Noel's effect dulls every opponent Forward even though its cost has already put Noel
    91	  into the Break Zone; Undead Princess's +4000 lands on a chosen Forward after she has left the field.
    92	- **C3-A3 (cost triggers first)** Paying Noel's self-break cost with an opponent Lightning in play resolves
    93	  **Lightning's triggered Haste grant before Noel's dull-all**, per the FIFO agenda.
    94	- **C3-A4 (cost is not a break)** A source with `cannotBeBroken` can still pay a self-break cost; the
    95	  transition carries `reason: 'cost'`; Lightning's "put from the field into the Break Zone" observer **does**
    96	  fire; and no `broken` / `brokenByAbility` / `breakPrevented` event is emitted. All four asserted.
    97	- **C3-A5 (legality, as constructed unit tests, not a sweep)** Separately: `[Dull]` costs are illegal from a
    98	  dulled source and from one that entered this turn without Haste, but **legal with Haste**; Undead Princess
    99	  is legal **while dulled and freshly played**; a CP payment may not use the source as either a dulled Backup
   100	  or a discard; an activation with no legal target is absent from `legalCommands` entirely; and activation is
   101	  illegal outside the turn player's Main Phases. Rare positions (fresh Noel with Haste, no legal non-source
   102	  target) will not turn up reliably in a seeded sweep, so they are constructed.
   103	- **C3-A6 (`ABILITY_CLAUSES` must NOT change)** It counts *printed* clauses, implemented or not
   104	  (`cards/src/abilities.ts:21`); revision 1 asked for it to drop by four, which would have falsely hidden
   105	  Miner's and Undead Princess's still-missing clauses. Assert instead that the implemented AST count rises by
   106	  six and the derived missing-warning count falls by six.
   107	- **C3-A7 (browser)** Activations appear as ordinary choices on their source card, labelled with the printed
   108	  cost, with payment variants collapsed to one button; narration says the ability was **activated**, not
   109	  "triggered" (`useGame.ts:77`); a human can use all six in a driven game.
   110	- **C3-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200
   111	  zero failures; ISMCTS still beats greedy over a mirrored run — **as a regression guard only**. Six clauses
   112	  are far below the noise floor of a 120-game run, and no strength improvement will be claimed from it.
   113	
   114	## Staging
   115	
   116	The dangerous seam is not any individual AST; it is the transaction from declaration through simultaneous
   117	costs, cost triggers and queued resolution.
   118	
   119	1. **Substrate, no cards.** Action metadata (`sourceZone`, cost shape, `abilityId`), the command and its
   120	   codecs, target preflight, generalized CP with exclusions, atomic cost transitions with `reason: 'cost'`,
   121	   agenda ordering, the `draw` effect and the `drawCards` extraction, AI enumeration, UI payment collapsing.
   122	2. **The six clauses**, plus the adversarial tests above.
59:   including the Haste exception? Is restricting activation to the turn player's Main Phases 1 and 2
76:FORMAT: `## BLOCKER` (must be resolved before code), `## MAJOR`, `## MINOR`, then
78:**Fix:**. Do not pad — if a decision is sound, one line and move on.
176:    54	| C3-2 | **Costs are a declared list on the ability, paid atomically before any effect runs** | `cost: { cp?: {amount, element?}, dull?: true, selfBreak?: true }`. All of it is paid, or none of it is and the command is not legal. CR §1.3.3: an ability's cost is paid on activation, and the effect resolves afterwards — so a Noel that dulls and breaks itself has already left the field when "dull all opponent Forwards" resolves, and must still resolve. This is exactly the frame/agenda separation C1 built, so the effect half needs no new machinery. |
179:    57	| C3-5 | **MVP0-SIMPLIFICATION: activation is restricted to the turn player during Main Phase 1 or 2** | The real rules let action abilities be used whenever a player has priority. MVP0 has no stack and `priority` is always the turn player (`state.ts:47`), so there is no window in which a non-turn player could act anyway. Restricting to the Main Phases is therefore not a further loss of fidelity — it is the honest statement of what the existing priority model can already express. Marked at the site, and listed in the README's deviations. |
180:    58	| C3-6 | **`legalCommands` enumerates activations, and the AI gets them for free** | `candidateCommands` and the browser choice set are both built from `legalCommands`, so an activation that is legal is automatically searchable and clickable. The AI needs no special casing — but see the risk below about whether it will *use* them. |
208:    86	- **C3-A3 (cost validation)** An activation is illegal when: the source is dulled, the source entered this
215:    93	- **C3-A5** The browser offers activations as ordinary choices, with the printed cost in the label, and a
427:    62	FORMAT: `## BLOCKER` (must be resolved before code), `## MAJOR`, `## MINOR`, then
577:   212	    35	| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
813:   448	   145	     3	## BLOCKER
2773:  2408	  2105	     3	## BLOCKER
5191:  4826	  4523	     7	import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'
5219:  4854	  4551	    35	        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
5229:  4864	  4561	    45	          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
5555:  5190	  4887	   194	    // C1: ability targets are card ids like any other. `chooseMode` answers are indices into the pending's
5557:  5192	  4889	   196	    case 'chooseTargets': return [...c.targets]
5905:  5540	  5237	    23	    case 'chooseTargets': return c.targets
6031:  5666	  5363	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
6060:  5695	  5392	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:47:| C1-10 | The five C1 clauses | **Noel ETB** (0..2 opponent targets, dull) · **Shantotto ETB** (mode → nested target → Haste / cannot-be-broken) · **Cloud ETB only** (mass untargeted power + keyword) · **Billy Bob ETB** (Break-Zone targeting and zone movement) · **Ramuh Summon** (0..2 of 3 modes, damage, sequential target choices — and the only exercise of the Summon path, which is dead code today). |
6066:  5701	  5398	docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-code-review.md:21:Not safe to merge until the `settle()` resume ordering is fixed. The five AST declarations themselves match the printed target sets exactly: Noel is opponent-only 0..2; Shantotto’s Haste mode targets any non-source Forward while protection targets your Forward including herself; Cloud affects all your Forwards including itself; Billy Bob targets your Break Zone Forward while excluding every Billy Bob; and Ramuh selects 0..2 unrestricted Forward modes. The Noel EX/action and Cloud Attack-Phase deferrals and clause warnings are correct. Program-counter resumption, off-field sources, persistent step budgeting, current game-over cleanup, determinisation, and forced-decision draining otherwise checked out. Strict real-pool runs finished 200/200 at 197–3 and 199–1, with a 20-game greedy mirror completing; ESLint passed, while Vitest could not create its temporary directory in the read-only sandbox.
6091:  5726	  5423	packages/ai/src/ismcts/search.ts:373:      // effect — a cast reveals the card, a discard puts it face up in the Break Zone, attacks/blocks/targets
6096:  5731	  5428	docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:31:**Fix:** Define private/revealed choice visibility before adding deck targets. Preserve or rebind authorized candidate IDs in the acting player’s determinisation and redact them from unauthorized views.
6114:  5749	  5446	apps/web/test/commands.test.ts:318:    expect(describeChoice(v, targets([901, 902]))).toBe('Dull Cloud and Sphene')
6115:  5750	  5447	apps/web/test/commands.test.ts:319:    expect(describeChoice(v, targets([901]))).toBe('Dull Cloud')
6116:  5751	  5448	apps/web/test/commands.test.ts:321:    expect(describeChoice(breakZoneView(), targets([901]))).toBe('Return Cloud')
6118:  5753	  5450	apps/web/test/commands.test.ts:383:    expect(describeChoice(nestedView(0), targets([901]))).toBe('Dull Cloud')
6119:  5754	  5451	apps/web/test/commands.test.ts:384:    expect(describeChoice(nestedView(1), targets([901]))).toBe('Give Haste to Cloud')
6123:  5758	  5455	apps/web/test/commands.test.ts:445:    expect(describeChoice(v, targets([901]))).toBe('Target Cloud')
6201:  5836	  5533	    29	Pending targets contain raw `CardId`s at [state.ts:29](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/state.ts:29). Views copy pending resolution data wholesale at [view.ts:31](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/view.ts:31), while determinisation creates replacement hidden-card IDs and then copies those stale pending IDs at [determinise.ts:27](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/determinise.ts:27). Deck-search candidates would therefore be orphaned for the acting AI and potentially leak private identifiers to opponents.
6203:  5838	  5535	    31	**Fix:** Define private/revealed choice visibility before adding deck targets. Preserve or rebind authorized candidate IDs in the acting player’s determinisation and redact them from unauthorized views.
6642:  6277	  5974	packages/ai/src/candidates.ts:263:  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
6654:  6289	  5986	apps/web/src/game/commands.ts:306:    case 'chooseTargets': return [...c.targets]
6655:  6290	  5987	apps/web/src/game/commands.ts:365:    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
6660:  6295	  5992	packages/ai/src/ismcts/keys.ts:318:    return { type: 'chooseTargets', player, targets }
6723:  6358	  6055	   228	      return `${head}${FIELD}${joinRefs(command.targets.map(r))}`
6807:  6442	  6139	   312	    const targets = ids(args[0])
6808:  6443	  6140	   313	    if (!pending || !targets || !distinct(targets)) return null
6809:  6444	  6141	   314	    if (targets.length < pending.min || targets.length > pending.max) return null
6812:  6447	  6144	   317	    if (targets.some((t) => !pending.candidates.includes(t))) return null
6813:  6448	  6145	   318	    return { type: 'chooseTargets', player, targets }
6904:  9917	   130	 * The legal targets of one `TargetSpec`, in a fixed player-0-then-1 order so a live state and its
7332: 10345	   294	 * (spec C2-13): it would have to fire while a frame is already mid-flight choosing its targets, and the agenda
7421: 10434	packages/engine/src/resolve.ts:475:export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
7475: 10488	packages/engine/src/apply.ts:75:      case 'chooseTargets': [s, events] = applyChooseTargets(state, command.player, command.targets); break
8056: 11069	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
8070: 11083	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:47:| C1-10 | The five C1 clauses | **Noel ETB** (0..2 opponent targets, dull) · **Shantotto ETB** (mode → nested target → Haste / cannot-be-broken) · **Cloud ETB only** (mass untargeted power + keyword) · **Billy Bob ETB** (Break-Zone targeting and zone movement) · **Ramuh Summon** (0..2 of 3 modes, damage, sequential target choices — and the only exercise of the Summon path, which is dead code today). |
8102: 11115	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
8125: 11138	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5392:docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:47:| C1-10 | The five C1 clauses | **Noel ETB** (0..2 opponent targets, dull) · **Shantotto ETB** (mode → nested target → Haste / cannot-be-broken) · **Cloud ETB only** (mass untargeted power + keyword) · **Billy Bob ETB** (Break-Zone targeting and zone movement) · **Ramuh Summon** (0..2 of 3 modes, damage, sequential target choices — and the only exercise of the Summon path, which is dead code today). |
8128: 11141	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5398:docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-code-review.md:21:Not safe to merge until the `settle()` resume ordering is fixed. The five AST declarations themselves match the printed target sets exactly: Noel is opponent-only 0..2; Shantotto’s Haste mode targets any non-source Forward while protection targets your Forward including herself; Cloud affects all your Forwards including itself; Billy Bob targets your Break Zone Forward while excluding every Billy Bob; and Ramuh selects 0..2 unrestricted Forward modes. The Noel EX/action and Cloud Attack-Phase deferrals and clause warnings are correct. Program-counter resumption, off-field sources, persistent step budgeting, current game-over cleanup, determinisation, and forced-decision draining otherwise checked out. Strict real-pool runs finished 200/200 at 197–3 and 199–1, with a 20-game greedy mirror completing; ESLint passed, while Vitest could not create its temporary directory in the read-only sandbox.
8160: 11173	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5446:apps/web/test/commands.test.ts:318:    expect(describeChoice(v, targets([901, 902]))).toBe('Dull Cloud and Sphene')
8161: 11174	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5447:apps/web/test/commands.test.ts:319:    expect(describeChoice(v, targets([901]))).toBe('Dull Cloud')
8162: 11175	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5448:apps/web/test/commands.test.ts:321:    expect(describeChoice(breakZoneView(), targets([901]))).toBe('Return Cloud')
8164: 11177	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5450:apps/web/test/commands.test.ts:383:    expect(describeChoice(nestedView(0), targets([901]))).toBe('Dull Cloud')
8165: 11178	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5451:apps/web/test/commands.test.ts:384:    expect(describeChoice(nestedView(1), targets([901]))).toBe('Give Haste to Cloud')
8169: 11182	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5455:apps/web/test/commands.test.ts:445:    expect(describeChoice(v, targets([901]))).toBe('Target Cloud')
8221: 11234	docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-code-review.md:21:Not safe to merge until the `settle()` resume ordering is fixed. The five AST declarations themselves match the printed target sets exactly: Noel is opponent-only 0..2; Shantotto’s Haste mode targets any non-source Forward while protection targets your Forward including herself; Cloud affects all your Forwards including itself; Billy Bob targets your Break Zone Forward while excluding every Billy Bob; and Ramuh selects 0..2 unrestricted Forward modes. The Noel EX/action and Cloud Attack-Phase deferrals and clause warnings are correct. Program-counter resumption, off-field sources, persistent step budgeting, current game-over cleanup, determinisation, and forced-decision draining otherwise checked out. Strict real-pool runs finished 200/200 at 197–3 and 199–1, with a 20-game greedy mirror completing; ESLint passed, while Vitest could not create its temporary directory in the read-only sandbox.
8726: 11739	   373	      // effect — a cast reveals the card, a discard puts it face up in the Break Zone, attacks/blocks/targets
8967: 11980	docs/superpowers/specs/2026-08-27-rung-d1-ismcts.md:20:| D-2 | **Node identity is semantic, never by `CardId`** | This is the crux of the rung. `Command` embeds `CardId` throughout, and each determinisation assigns fresh sequential synthetic ids — so the same numeric id can mean **different cards in different worlds** (false matches) and the same semantic card can get **different ids** (false splits). `ActionKey` encodes: public zone + position for field and Break-Zone cards; **card code + occurrence** for private-hand casts and discards; normalised (sorted) sets for attackers, payments, targets and assignments. `ObservationKey` is a canonical `PlayerView` digest with every id — including in `attack`, `pending` and `resolution` — replaced by a canonical reference. Keys are decoded against the *current* determinisation; the real root `Command` is what gets returned. |
8975: 11988	docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-review.md-3-## BLOCKER
8981: 11994	docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-review.md:9:**Fix:** Make a node `(parent history, ActionKey, ObservationKey)`, with no state transpositions initially. `ActionKey` must encode card semantics: public zone/position references for field and break-zone cards; card code plus occurrence for private-hand casts/discards; normalized sets for attackers, payments, targets, and assignments. After `apply`, append a canonical root-player observation derived from `PlayerView`, replacing all IDs—including `attack`, `pending`, and `resolution` references—with canonical references. Decode keys against the current determinisation, but retain the real root `Command` for return. Add cross-world tests covering “same ID/different code” and “same action/different ID.”
9016: 12029	docs/superpowers/plans/2026-08-27-rung-d1-ismcts.codex-code-review.md:5:**`decodeAction` can return an observably different command from the one the tree evaluated.** List-valued commands are sorted into keys (`packages/ai/src/ismcts/keys.ts:214`, `:224`, `:226`, `:228`), simulations apply the original candidate (`packages/ai/src/ismcts/search.ts:372`, `:377`), but the final result prefers a freshly decoded command (`packages/ai/src/ismcts/search.ts:417`). Decoding consumes refs in sorted-key order (`packages/ai/src/ismcts/keys.ts:357`, `:376`), while the engine preserves command order in the Break Zone and resolution frame (`packages/engine/src/cp.ts:105`, `packages/engine/src/phases.ts:79`, `packages/engine/src/resolve.ts:485`). `observationKey` then treats Break-Zone order as significant (`packages/ai/src/ismcts/keys.ts:407`). A direct probe showed `[V-F7,V-F1]` being evaluated, decoded as `[V-F1,V-F7]`, and producing different Break-Zone observations. The round-trip test checks only re-keying and legality, not transition equivalence (`packages/ai/test/ismcts-keys.test.ts:264`). **Fix:** Return `rootCommands.get(best.key)` as the authoritative live command, or canonicalize/decode commands before every tree `apply`. Add tests comparing post-apply `ObservationKey`s for original versus decoded casts, discards, targets, and assignments.
9244: 12257	    75	      case 'chooseTargets': [s, events] = applyChooseTargets(state, command.player, command.targets); break
9757: 12770	   242	      if (!c.targets.length) return 'Choose no targets'
9759: 12772	   244	      return `${verb?.imperative ?? 'Target'} ${listNames(v, c.targets)}`
9789: 12802	   274	      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
9819: 12832	   304	    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
9821: 12834	   306	    case 'chooseTargets': return [...c.targets]
9880: 12893	   365	    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
10762: 13775	apps/web/test/useGame.test.ts:408:    // "choose no targets" button to escape with. The board now draws any such orphan target in its own row.
11083: 14096	     7	import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'
11111: 14124	    35	        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
11121: 14134	    45	          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
11170: 14183	    15	  | { type: 'chooseTargets'; player: PlayerId; targets: readonly CardId[] }
11192: 14205	   263	  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
11216: 14229	   287	      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
11435: 14448	   336	    expect(decodeAction(v, 'chooseTargets|p0|f1:0')).toEqual({ type: 'chooseTargets', player: 0, targets: [v.fields[1].forwards[0]!.id] })
11721: 14734	   136	  // Every clickable choice must be reachable, or the game dead-ends: Billy Bob's ETB targets your BREAK ZONE,
11735: 14748	   136	  // Every clickable choice must be reachable, or the game dead-ends: Billy Bob's ETB targets your BREAK ZONE,
11816: 14829	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
11843: 14856	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
11863: 14876	## BLOCKER
11941: 14954	The board renders only deck count (`apps/web/src/ui/Board.tsx:57`) and displays off-board cards only when they are targets in the human’s own choice set (`apps/web/src/ui/Board.tsx:89`, `apps/web/src/ui/Board.tsx:141`). While AI Miner is choosing, the human has no such target choices, so the five publicly revealed cards will not appear.
11984: 14997	## BLOCKER
12062: 15075	The board renders only deck count (`apps/web/src/ui/Board.tsx:57`) and displays off-board cards only when they are targets in the human’s own choice set (`apps/web/src/ui/Board.tsx:89`, `apps/web/src/ui/Board.tsx:141`). While AI Miner is choosing, the human has no such target choices, so the five publicly revealed cards will not appear.
12106:The reordering rationale is directionally sound: deck knowledge is genuinely a multi-layer information-model change, while activation can reuse much of the current public-state machinery. I’m now checking whether the proposed “reuse” claims survive the exact command/payment and resolution code paths—especially cost events and timing.
12241:    15	  | { type: 'chooseTargets'; player: PlayerId; targets: readonly CardId[] }
12301:    54	  /** Choose `min..max` targets, then run `then` once with `chosen` bound to them. min 0 = "up to". */
12551:     7	import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'
12579:    35	        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
12589:    45	          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
12860:   130	 * The legal targets of one `TargetSpec`, in a fixed player-0-then-1 order so a live state and its
13205:   475	export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
13208:   478	  if (node.kind !== 'chooseTargets') throw new IllegalCommandError('the waiting ability is not choosing targets')
13209:   479	  if (new Set(targets).size !== targets.length) throw new IllegalCommandError('duplicate target')
13212:   482	  if (targets.length < node.min || targets.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} targets, got ${targets.length}`)
13213:   483	  for (const id of targets) if (!candidates.includes(id)) throw new IllegalCommandError(`${id} is not a legal target`)
13215:   485	  const active: Frame = { ...frame, chosen: [...targets], path: [...frame.path, 0] }
13405:    75	      case 'chooseTargets': [s, events] = applyChooseTargets(state, command.player, command.targets); break
13617:    74	export function legalBlockers(state: GameState, player: PlayerId): CardId[] {
13641:    98	/** All ways to split `total` over `targets` in multiples of 1000, each part ≥ 1000 (targets that receive nothing are omitted). */
13642:    99	function splits(total: number, targets: CardId[]): Assignment[][] {
13646:   103	    if (i === targets.length) { if (left === 0) out.push(acc); return }
13648:   105	    for (let a = 1000; a <= left; a += 1000) rec(i + 1, left - a, [...acc, { target: targets[i] as CardId, amount: a }])
13676:   133	  if (assignments.some((a) => !at.attackers.includes(a.target))) throw new IllegalCommandError('targets must be attacking forwards')
14163:    54	  /** Choose `min..max` targets, then run `then` once with `chosen` bound to them. min 0 = "up to". */
14434:   130	 * The legal targets of one `TargetSpec`, in a fixed player-0-then-1 order so a live state and its
14779:   475	export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
14782:   478	  if (node.kind !== 'chooseTargets') throw new IllegalCommandError('the waiting ability is not choosing targets')
14783:   479	  if (new Set(targets).size !== targets.length) throw new IllegalCommandError('duplicate target')
14786:   482	  if (targets.length < node.min || targets.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} targets, got ${targets.length}`)
14787:   483	  for (const id of targets) if (!candidates.includes(id)) throw new IllegalCommandError(`${id} is not a legal target`)
14789:   485	  const active: Frame = { ...frame, chosen: [...targets], path: [...frame.path, 0] }
14979:    75	      case 'chooseTargets': [s, events] = applyChooseTargets(state, command.player, command.targets); break
15370:   130	 * The legal targets of one `TargetSpec`, in a fixed player-0-then-1 order so a live state and its
15479:   475	export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
15482:   478	  if (node.kind !== 'chooseTargets') throw new IllegalCommandError('the waiting ability is not choosing targets')
15483:   479	  if (new Set(targets).size !== targets.length) throw new IllegalCommandError('duplicate target')
15486:   482	  if (targets.length < node.min || targets.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} targets, got ${targets.length}`)
15487:   483	  for (const id of targets) if (!candidates.includes(id)) throw new IllegalCommandError(`${id} is not a legal target`)
15489:   485	  const active: Frame = { ...frame, chosen: [...targets], path: [...frame.path, 0] }
15898:   294	 * (spec C2-13): it would have to fire while a frame is already mid-flight choosing its targets, and the agenda
16034:packages/cards/test/abilities.test.ts:118:    const t = apply(cast(s, '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP)).state, { type: 'chooseTargets', player: 0, targets: [] }).state
16250:     1	import { abilityOf, actingPlayer, attackCheck, castCheck, defOf, effectivePower, findFieldCard, keywordsOf, legalAttackSets, legalBlockers, legalCommands, legalPartyDamageAssignments, targetCandidates, type CardId, type Command, type Effect, type GameState, type Pending, type PlayerId } from '@fftcg/engine'
16416:   167	        // Priced by the SAME helpers `evaluate` uses, so the value the policy targets is the value the search
16512:   263	  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
16536:   287	      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
16753:   194	    // C1: ability targets are card ids like any other. `chooseMode` answers are indices into the pending's
16755:   196	    case 'chooseTargets': return [...c.targets]
17308:   242	      if (!c.targets.length) return 'Choose no targets'
17310:   244	      return `${verb?.imperative ?? 'Target'} ${listNames(v, c.targets)}`
17340:   274	      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
17370:   304	    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
17372:   306	    case 'chooseTargets': return [...c.targets]
17431:   365	    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
17629:   136	  // Every clickable choice must be reachable, or the game dead-ends: Billy Bob's ETB targets your BREAK ZONE,
17730:   287	      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
17949:   194	    // C1: ability targets are card ids like any other. `chooseMode` answers are indices into the pending's
17951:   196	    case 'chooseTargets': return [...c.targets]
18490:   242	      if (!c.targets.length) return 'Choose no targets'
18492:   244	      return `${verb?.imperative ?? 'Target'} ${listNames(v, c.targets)}`
18522:   274	      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
18809:docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:54:| C3-2 | **Costs are a declared list on the ability, paid atomically before any effect runs** | `cost: { cp?: {amount, element?}, dull?: true, selfBreak?: true }`. All of it is paid, or none of it is and the command is not legal. CR §1.3.3: an ability's cost is paid on activation, and the effect resolves afterwards — so a Noel that dulls and breaks itself has already left the field when "dull all opponent Forwards" resolves, and must still resolve. This is exactly the frame/agenda separation C1 built, so the effect half needs no new machinery. |
18812:docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:57:| C3-5 | **MVP0-SIMPLIFICATION: activation is restricted to the turn player during Main Phase 1 or 2** | The real rules let action abilities be used whenever a player has priority. MVP0 has no stack and `priority` is always the turn player (`state.ts:47`), so there is no window in which a non-turn player could act anyway. Restricting to the Main Phases is therefore not a further loss of fidelity — it is the honest statement of what the existing priority model can already express. Marked at the site, and listed in the README's deviations. |
18818:docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:86:- **C3-A3 (cost validation)** An activation is illegal when: the source is dulled, the source entered this
18820:docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:93:- **C3-A5** The browser offers activations as ordinary choices, with the printed cost in the label, and a
18872:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
19215:packages/ai/test/candidates.test.ts:104:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([pumped])
19216:packages/ai/test/candidates.test.ts:116:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([hurt])
19217:packages/ai/test/candidates.test.ts:128:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([plain])
19218:packages/ai/test/candidates.test.ts:142:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([dear])
19219:packages/ai/test/candidates.test.ts:153:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([prize])
19221:packages/ai/test/candidates.test.ts:166:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([fresh])   // the 9000 gains NOTHING and must not win on power
19223:packages/ai/test/candidates.test.ts:192:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([exposed])
19231:packages/ai/test/candidates.test.ts:282:    expect(targetsOf(candidateCommands(withCascade, 0)[0])).toEqual([big])
19233:packages/ai/test/candidates.test.ts:288:    expect(targetsOf(candidateCommands(without, 0)[0])).toEqual([small])
19234:packages/ai/test/candidates.test.ts:304:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([backup])                     // …and the policy follows value, not type
19238:packages/ai/test/candidates.test.ts:350:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([fresh])
19371:   228	      return `${head}${FIELD}${joinRefs(command.targets.map(r))}`
19455:   312	    const targets = ids(args[0])
19456:   313	    if (!pending || !targets || !distinct(targets)) return null
19457:   314	    if (targets.length < pending.min || targets.length > pending.max) return null
19460:   317	    if (targets.some((t) => !pending.candidates.includes(t))) return null
19461:   318	    return { type: 'chooseTargets', player, targets }
19550:    23	    case 'chooseTargets': return c.targets
19656:    45	    case 'chooseTargets': return c.targets.length ? `Target ${c.targets.map((id) => name(v, id)).join(', ')}` : 'Choose no targets'
19743:## BLOCKER
19745:**`Payment` is reusable, but the existing cast payment validator is not.**
19749:**Fix:** Keep `Payment`, but generalize the machinery around it to accept `{ amount, requiredElements, excludedSources }`. Apply exclusions to both Backup and discard sources, and use the same API from casting, enumeration, `preferredPayment`, and activation. Encode requirements as an Element array, not singular `element?`, so repeated/multi-Element costs do not require another fork. Generic `[2]` is `{ amount: 2, requiredElements: [] }`; `[Lightning]` is `{ amount: 1, requiredElements: ['lightning'] }`; `[0]` produces only the empty payment.
19753:**The proposed command omits activation-time target legality, allowing a player to pay a cost for an ability they cannot activate.**
19755:`resolve.ts` currently discovers targets after a frame starts and treats an empty set as a successful no-op (`packages/engine/src/resolve.ts:235-240`). That is correct for triggered abilities, but CR §11.6.5 says a targeted action ability needs a legal target before activation and cannot choose itself. Without a preflight, Undead Princess can break herself when she is the only Forward and get nothing; if checked before payment without `excludeSource`, she can illegally count herself as the target. [CR 3.3 §11.6.5](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
19757:**Fix:** Make activation choices part of the activation transaction. Prefer `activateAbility { player, source, abilityId, payment, targets }`, validate targets against the pre-cost state with the source excluded, and initialize `Frame.chosen` accordingly. At minimum, preflight and snapshot the eligible set before payment; do not reuse the triggered-ability “no legal target → no-op” path.
19761:**C3-A3 wrongly applies `[Dull]` restrictions to Undead Princess.**
19765:**Fix:** Gate active status, `enteredTurn`, and the Haste exception on `cost.dull === true`. Add positive tests that a dull/fresh Undead Princess can activate and that a fresh Noel with Haste can activate.
19769:**C3-A4 contradicts C3-4: a self-break cost must trigger Lightning’s zone-movement watcher.**
19775:**Fix:** Add `ZoneTransition.reason: 'cost'`. Snapshot the action frame’s source, controller, ability, targets, and the transition’s pre-cost `FieldCard` before mutation; apply every cost simultaneously; call `enqueueZoneChangeTriggers(pre, post, transitions)`; then append the action frame. True zone-movement observers fire; future explicitly “broken” observers filter out `reason: 'cost'`. Change `describeTriggerCause`, which currently says every zone move “was broken” (`apps/web/src/game/commands.ts:60-63`), to the accurate “was put into the Break Zone.”
19779:**Miner’s effect cannot be represented by the current AST.**
19783:**Fix:** Add `{ kind: 'draw'; count: number }`, extract `drawCards` into a neutral module imported by both phases and resolution, and preserve its empty-deck loss semantics.
19785:## MAJOR
19787:**Main-phase-only activation is a real gameplay deviation, not merely a restatement of the current priority model.**
19793:**Fix:** Either allow activation during attack declaration now and explicitly defer post-attack/block response windows, or retain main-only activation but document it as “action abilities are sorcery-speed; Undead Princess cannot be used as a combat trick.” Do not claim there is no further loss of fidelity.
19797:**The AI does not receive activations “for free.”**
19799:`candidateCommands` manually emits casts and pass in Main Phases (`packages/ai/src/candidates.ts:295-302`); SO-ISMCTS searches that list (`packages/ai/src/ismcts/search.ts:369`). An activation added only to `legalCommands` will never be considered by either agent. Action keys, decoding, and synthetic-ID guards also need explicit variants (`packages/ai/src/ismcts/keys.ts:202-237`, `packages/ai/src/ismcts/keys.ts:267-334`, `packages/ai/src/greedy.ts:186-199`).
19804:- With the current weights, losing active 2000-power Undead Princess is worth exactly 8, and giving another active Forward +4000 is also worth exactly 8 (`packages/ai/src/evaluate.ts:21-34`, `packages/ai/src/evaluate.ts:87-93`). Greedy retains the earlier command on a tie (`packages/ai/src/greedy.ts:95-107`), so activation ordering can make it sacrifice a body for a transient pump with no demonstrated payoff.
19806:**Fix:** Explicitly generate one preferred-payment activation per `(source, abilityId, target set)`, add the ISMCTS codec/ID plumbing, and test that both agents actually choose an activation. Add a small active-Backup/ready-CP term and discount positive `powerBonus` when it cannot affect combat before expiry—especially Main Phase 2. Add “pass over useless Red Mage” and “pass over unusable Undead Princess pump” tests.
19810:**Use stable `abilityId`, not an index into the implemented ability array.**
19814:**Fix:** Use `abilityId` in commands, frames, action keys, logs, and tests. Printed order remains the order of `def.abilities`; command identity must not depend on that position.
19818:**Source zone belongs in the action-ability definition now.**
19822:**Fix:** Add an action discriminant containing at least `sourceZone: 'field' | 'hand' | 'breakZone'` and cost metadata. Zone is an activation precondition, not part of the cost. Leave timing and once-per-turn extensions additive, but do not infer the source zone from a particular cost.
19826:**The browser receives legal activations, but its usable one-choice UI does not come for free.**
19828:The board already renders any field card appearing in `choices.byCard` as clickable (`apps/web/src/ui/Board.tsx:17-43`), so `Board.tsx` needs no special-case UI. But `describeChoice`, `subjectsOf`, and `sameCommand` have exhaustive command handling with no activation (`apps/web/src/game/commands.ts:225-254`, `:295-310`, `:349-369`). More importantly, `preferredChoices` collapses payment variants only for casts (`:372-420`); Red Mage or Miner would expose every enumerated payment as separate buttons.
19830:**Fix:** Treat casts and activations as “payable commands” for payment collapsing, attach an activation to its source card in `subjectsOf`, compare `source + abilityId + targets + payment`, and render the printed cost plus chosen CP sources. Emit/narrate `abilityActivated`, not `abilityTriggered`; the latter currently produces “ability triggers” (`apps/web/src/game/useGame.ts:77-80`).
19834:**C3-A6 misunderstands `ABILITY_CLAUSES`.**
19838:**Fix:** Keep every `ABILITY_CLAUSES` value unchanged. Assert that implemented AST count rises by four and the derived missing count falls by four.
19840:## MINOR
19842:**The two principal CR citations are wrong.**
19844:CR §1 contains only the game-scope rule; cost atomicity is §11.6.10, activation procedure is §§11.6.3–11.6.11, and source independence is §11.5.4. The `[Dull]` control/Haste rule is §11.6.2.2, not §9.3.2 (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:54-55`). The cost-versus-break distinction is §15.1.1.3.2. [Official CR 3.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
19846:**Fix:** Replace the citations before turning them into code comments or test names.
19850:**CR 3.3 permits over-generation, not overpayment.**
19854:**Fix:** Document `Payment` as generated sources and `canPay` as proving a usable subset exists; call extras “unused generated CP.”
19858:**The seeded reachability sweep is not enough for the new legality boundary.**
19862:**Fix:** Keep the sweep, but add constructed unit tests for every legality predicate, payment exclusion, transition reason, watcher order, and target-before-cost rollback.
19864:## WHAT I WOULD DO DIFFERENTLY
19866:**Keep activated abilities ahead of deck knowledge; the reordering is right.**
19868:Deck knowledge still requires durable knowledge ownership, pending reconstruction, two search identities, and observer-relative narration (`docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:9-31`). None of the activation fixes above entangles determinisation with private information.
19870:**Fix:** Keep deck knowledge deferred, but soften “eight clauses behind one primitive”: activation also needs target declaration, generalized costs, a draw effect, command codecs, and timing policy.
19874:**Build the activation substrate first, then land cards in two small stages.**
19876:The dangerous seam is not any individual AST; it is the transaction from activation declaration through simultaneous costs, cost triggers, and queued resolution (`packages/engine/src/apply.ts:25-57`).
19878:**Fix:** Stage 1: action metadata/source zone, stable command identity, target preflight, generalized CP, atomic cost transitions, draw, agenda ordering, AI/UI codecs. Stage 2: Red Mage, Noel, Miner, and Undead Princess plus the adversarial tests.
19882:**I would pull the two hand-sourced draw abilities into a short follow-up—or into this rung if scope allows.**
19886:**Fix:** Make source zone first-class now; preferably use the two hand clauses to prove it. Leave Break-Zone Undead Princess and Sphene in C4.
19889:## BLOCKER
19891:**`Payment` is reusable, but the existing cast payment validator is not.**
19895:**Fix:** Keep `Payment`, but generalize the machinery around it to accept `{ amount, requiredElements, excludedSources }`. Apply exclusions to both Backup and discard sources, and use the same API from casting, enumeration, `preferredPayment`, and activation. Encode requirements as an Element array, not singular `element?`, so repeated/multi-Element costs do not require another fork. Generic `[2]` is `{ amount: 2, requiredElements: [] }`; `[Lightning]` is `{ amount: 1, requiredElements: ['lightning'] }`; `[0]` produces only the empty payment.
19899:**The proposed command omits activation-time target legality, allowing a player to pay a cost for an ability they cannot activate.**
19901:`resolve.ts` currently discovers targets after a frame starts and treats an empty set as a successful no-op (`packages/engine/src/resolve.ts:235-240`). That is correct for triggered abilities, but CR §11.6.5 says a targeted action ability needs a legal target before activation and cannot choose itself. Without a preflight, Undead Princess can break herself when she is the only Forward and get nothing; if checked before payment without `excludeSource`, she can illegally count herself as the target. [CR 3.3 §11.6.5](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
19903:**Fix:** Make activation choices part of the activation transaction. Prefer `activateAbility { player, source, abilityId, payment, targets }`, validate targets against the pre-cost state with the source excluded, and initialize `Frame.chosen` accordingly. At minimum, preflight and snapshot the eligible set before payment; do not reuse the triggered-ability “no legal target → no-op” path.
19907:**C3-A3 wrongly applies `[Dull]` restrictions to Undead Princess.**
19911:**Fix:** Gate active status, `enteredTurn`, and the Haste exception on `cost.dull === true`. Add positive tests that a dull/fresh Undead Princess can activate and that a fresh Noel with Haste can activate.
19915:**C3-A4 contradicts C3-4: a self-break cost must trigger Lightning’s zone-movement watcher.**
19921:**Fix:** Add `ZoneTransition.reason: 'cost'`. Snapshot the action frame’s source, controller, ability, targets, and the transition’s pre-cost `FieldCard` before mutation; apply every cost simultaneously; call `enqueueZoneChangeTriggers(pre, post, transitions)`; then append the action frame. True zone-movement observers fire; future explicitly “broken” observers filter out `reason: 'cost'`. Change `describeTriggerCause`, which currently says every zone move “was broken” (`apps/web/src/game/commands.ts:60-63`), to the accurate “was put into the Break Zone.”
19925:**Miner’s effect cannot be represented by the current AST.**
19929:**Fix:** Add `{ kind: 'draw'; count: number }`, extract `drawCards` into a neutral module imported by both phases and resolution, and preserve its empty-deck loss semantics.
19931:## MAJOR
19933:**Main-phase-only activation is a real gameplay deviation, not merely a restatement of the current priority model.**
19939:**Fix:** Either allow activation during attack declaration now and explicitly defer post-attack/block response windows, or retain main-only activation but document it as “action abilities are sorcery-speed; Undead Princess cannot be used as a combat trick.” Do not claim there is no further loss of fidelity.
19943:**The AI does not receive activations “for free.”**
19945:`candidateCommands` manually emits casts and pass in Main Phases (`packages/ai/src/candidates.ts:295-302`); SO-ISMCTS searches that list (`packages/ai/src/ismcts/search.ts:369`). An activation added only to `legalCommands` will never be considered by either agent. Action keys, decoding, and synthetic-ID guards also need explicit variants (`packages/ai/src/ismcts/keys.ts:202-237`, `packages/ai/src/ismcts/keys.ts:267-334`, `packages/ai/src/greedy.ts:186-199`).
19950:- With the current weights, losing active 2000-power Undead Princess is worth exactly 8, and giving another active Forward +4000 is also worth exactly 8 (`packages/ai/src/evaluate.ts:21-34`, `packages/ai/src/evaluate.ts:87-93`). Greedy retains the earlier command on a tie (`packages/ai/src/greedy.ts:95-107`), so activation ordering can make it sacrifice a body for a transient pump with no demonstrated payoff.
19952:**Fix:** Explicitly generate one preferred-payment activation per `(source, abilityId, target set)`, add the ISMCTS codec/ID plumbing, and test that both agents actually choose an activation. Add a small active-Backup/ready-CP term and discount positive `powerBonus` when it cannot affect combat before expiry—especially Main Phase 2. Add “pass over useless Red Mage” and “pass over unusable Undead Princess pump” tests.
19956:**Use stable `abilityId`, not an index into the implemented ability array.**
19960:**Fix:** Use `abilityId` in commands, frames, action keys, logs, and tests. Printed order remains the order of `def.abilities`; command identity must not depend on that position.
19964:**Source zone belongs in the action-ability definition now.**
19968:**Fix:** Add an action discriminant containing at least `sourceZone: 'field' | 'hand' | 'breakZone'` and cost metadata. Zone is an activation precondition, not part of the cost. Leave timing and once-per-turn extensions additive, but do not infer the source zone from a particular cost.
19972:**The browser receives legal activations, but its usable one-choice UI does not come for free.**
19974:The board already renders any field card appearing in `choices.byCard` as clickable (`apps/web/src/ui/Board.tsx:17-43`), so `Board.tsx` needs no special-case UI. But `describeChoice`, `subjectsOf`, and `sameCommand` have exhaustive command handling with no activation (`apps/web/src/game/commands.ts:225-254`, `:295-310`, `:349-369`). More importantly, `preferredChoices` collapses payment variants only for casts (`:372-420`); Red Mage or Miner would expose every enumerated payment as separate buttons.
19976:**Fix:** Treat casts and activations as “payable commands” for payment collapsing, attach an activation to its source card in `subjectsOf`, compare `source + abilityId + targets + payment`, and render the printed cost plus chosen CP sources. Emit/narrate `abilityActivated`, not `abilityTriggered`; the latter currently produces “ability triggers” (`apps/web/src/game/useGame.ts:77-80`).
19980:**C3-A6 misunderstands `ABILITY_CLAUSES`.**
19984:**Fix:** Keep every `ABILITY_CLAUSES` value unchanged. Assert that implemented AST count rises by four and the derived missing count falls by four.
19986:## MINOR

exec
/bin/zsh -lc "nl -ba docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md | sed -n '19720,20060p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
 19720	    90	    case 'breakPrevented': return { kind: 'event', text: `${name(v, e.card)} survives — it ${FLAG_LABEL[e.flag]}` }
 19721	    91	    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'} (${e.result.reason})` }
 19722	    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
 19723	    93	    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
 19724	    94	    default: return null
 19725	    95	  }
 19726	    96	}
 19727	    97	
 19728	    98	/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
 19729	    99	function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
 19730	   100	  const code = v.cards[card]?.code
 19731	   101	  const def = code === undefined ? undefined : v.defs[code]
 19732	   102	  return def?.abilities?.find((a) => a.id === abilityId)?.trigger ?? null
 19733	   103	}
 19734	   104	
 19735	   105	/**
 19736	   106	 * §7.10 puts a broken card in its OWNER's Break Zone, which is where narration finds it once it has left the
 19737	   107	 * field. Owner and controller coincide for this pool — nothing in it changes control (rung C5) — so this is
 19738	   108	 * the controller the clause's `whose` is measured against.
 19739	   109	 */
 19740	   110	function holderOf(v: PlayerView, id: CardId): PlayerId {
 19741	
 19742	codex
 19743	## BLOCKER
 19744	
 19745	**`Payment` is reusable, but the existing cast payment validator is not.**
 19746	
 19747	`Payment` is only a description of CP sources (`packages/engine/src/commands.ts:4`), so retaining it is sound. But casting derives the amount and required Elements from the card definition (`packages/engine/src/cast.ts:33-37`), while Red Mage needs `1 + Lightning` despite having printed cost 2 (`packages/cards/data/cards.json:3-14`), and Miner needs generic 2—not Earth—despite having printed cost 3 (`packages/cards/data/cards.json:140-151`). `generateCp` also excludes `casting` only from discards (`packages/engine/src/cp.ts:33-35`), not from dulled Backups (`packages/engine/src/cp.ts:24-32`). Both Red Mage and Miner can therefore generate CP with themselves while also paying their `[Dull]`/self-break costs.
 19748	
 19749	**Fix:** Keep `Payment`, but generalize the machinery around it to accept `{ amount, requiredElements, excludedSources }`. Apply exclusions to both Backup and discard sources, and use the same API from casting, enumeration, `preferredPayment`, and activation. Encode requirements as an Element array, not singular `element?`, so repeated/multi-Element costs do not require another fork. Generic `[2]` is `{ amount: 2, requiredElements: [] }`; `[Lightning]` is `{ amount: 1, requiredElements: ['lightning'] }`; `[0]` produces only the empty payment.
 19750	
 19751	---
 19752	
 19753	**The proposed command omits activation-time target legality, allowing a player to pay a cost for an ability they cannot activate.**
 19754	
 19755	`resolve.ts` currently discovers targets after a frame starts and treats an empty set as a successful no-op (`packages/engine/src/resolve.ts:235-240`). That is correct for triggered abilities, but CR §11.6.5 says a targeted action ability needs a legal target before activation and cannot choose itself. Without a preflight, Undead Princess can break herself when she is the only Forward and get nothing; if checked before payment without `excludeSource`, she can illegally count herself as the target. [CR 3.3 §11.6.5](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19756	
 19757	**Fix:** Make activation choices part of the activation transaction. Prefer `activateAbility { player, source, abilityId, payment, targets }`, validate targets against the pre-cost state with the source excluded, and initialize `Frame.chosen` accordingly. At minimum, preflight and snapshot the eligible set before payment; do not reuse the triggered-ability “no legal target → no-op” path.
 19758	
 19759	---
 19760	
 19761	**C3-A3 wrongly applies `[Dull]` restrictions to Undead Princess.**
 19762	
 19763	The acceptance criterion says any dulled or newly entered source is illegal (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:86-89`), but those restrictions apply only when the cost contains the dull icon. Undead Princess’s first clause has only a self-to-Break-Zone cost (`packages/cards/data/cards.json:125-136`), so she may use it while dull and on the turn she enters. CR §11.6.2.2 applies the control-since-start/Haste rule specifically to abilities with `[Dull]`. [CR 3.3 §11.6.2.2](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19764	
 19765	**Fix:** Gate active status, `enteredTurn`, and the Haste exception on `cost.dull === true`. Add positive tests that a dull/fresh Undead Princess can activate and that a fresh Noel with Haste can activate.
 19766	
 19767	---
 19768	
 19769	**C3-A4 contradicts C3-4: a self-break cost must trigger Lightning’s zone-movement watcher.**
 19770	
 19771	C3-4 says the cost produces a `ZoneTransition` visible to C2 observers (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:56`), while C3-A4 says the observer must not fire (`:90-92`). The implemented observer is not “when broken”; its exact text is “put from the field into the Break Zone” (`packages/cards/src/abilities.ts:218-226`), and `watches` intentionally ignores `ZoneTransition.reason` (`packages/engine/src/resolve.ts:519-528`). It therefore must see Noel or Undead Princess paying this cost. What must not happen is a `broken`, `brokenByAbility`, or `breakPrevented` event. CR §15.1.1.3.2 explicitly says putting a card into the Break Zone as a cost is not breaking. [CR 3.3 §15.1.1.3.2](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19772	
 19773	There is also an ordering requirement. `drainResolution` consumes its queue FIFO (`packages/engine/src/resolve.ts:413-430`). Cost-triggered auto-abilities go above the already-declared action ability and resolve first. Merely “pay, then push the frame” works only if the cost watcher frames are enqueued before the action frame.
 19774	
 19775	**Fix:** Add `ZoneTransition.reason: 'cost'`. Snapshot the action frame’s source, controller, ability, targets, and the transition’s pre-cost `FieldCard` before mutation; apply every cost simultaneously; call `enqueueZoneChangeTriggers(pre, post, transitions)`; then append the action frame. True zone-movement observers fire; future explicitly “broken” observers filter out `reason: 'cost'`. Change `describeTriggerCause`, which currently says every zone move “was broken” (`apps/web/src/game/commands.ts:60-63`), to the accurate “was put into the Break Zone.”
 19776	
 19777	---
 19778	
 19779	**Miner’s effect cannot be represented by the current AST.**
 19780	
 19781	`Effect` has no draw operation (`packages/engine/src/abilities.ts:53-73`). The only draw primitive is in `phases.ts` (`packages/engine/src/phases.ts:10-18`), while `resolve.ts` deliberately cannot import `phases.ts` because `phases.ts` already imports it (`packages/engine/src/resolve.ts:16-19`, `packages/engine/src/phases.ts:8`). The claim that all four effect halves need no new machinery is therefore false.
 19782	
 19783	**Fix:** Add `{ kind: 'draw'; count: number }`, extract `drawCards` into a neutral module imported by both phases and resolution, and preserve its empty-deck loss semantics.
 19784	
 19785	## MAJOR
 19786	
 19787	**Main-phase-only activation is a real gameplay deviation, not merely a restatement of the current priority model.**
 19788	
 19789	The CR permits action abilities in both Main and Attack Phases (`packages/engine/src/state.ts:47`; [CR 3.3 §9.3.1.7](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)). The engine actually has an unblocked turn-player action point during attack declaration (`packages/engine/src/legal.ts:68-72`), although it immediately resolves damage after a block and exposes no combat response window (`packages/engine/src/attack.ts:87-95`).
 19790	
 19791	Noel and Red Mage still work before the first attack from Main Phase 1. Undead Princess does not work as the printed combat trick: she cannot pump after blockers, nor attack and then sacrifice herself to help a later attacker.
 19792	
 19793	**Fix:** Either allow activation during attack declaration now and explicitly defer post-attack/block response windows, or retain main-only activation but document it as “action abilities are sorcery-speed; Undead Princess cannot be used as a combat trick.” Do not claim there is no further loss of fidelity.
 19794	
 19795	---
 19796	
 19797	**The AI does not receive activations “for free.”**
 19798	
 19799	`candidateCommands` manually emits casts and pass in Main Phases (`packages/ai/src/candidates.ts:295-302`); SO-ISMCTS searches that list (`packages/ai/src/ismcts/search.ts:369`). An activation added only to `legalCommands` will never be considered by either agent. Action keys, decoding, and synthetic-ID guards also need explicit variants (`packages/ai/src/ismcts/keys.ts:202-237`, `packages/ai/src/ismcts/keys.ts:267-334`, `packages/ai/src/greedy.ts:186-199`).
 19800	
 19801	The evaluation has two predictable mistakes:
 19802	
 19803	- Backup status contributes nothing to material (`packages/ai/src/evaluate.ts:95-96`), so dulling Red Mage and other CP Backups can look free.
 19804	- With the current weights, losing active 2000-power Undead Princess is worth exactly 8, and giving another active Forward +4000 is also worth exactly 8 (`packages/ai/src/evaluate.ts:21-34`, `packages/ai/src/evaluate.ts:87-93`). Greedy retains the earlier command on a tie (`packages/ai/src/greedy.ts:95-107`), so activation ordering can make it sacrifice a body for a transient pump with no demonstrated payoff.
 19805	
 19806	**Fix:** Explicitly generate one preferred-payment activation per `(source, abilityId, target set)`, add the ISMCTS codec/ID plumbing, and test that both agents actually choose an activation. Add a small active-Backup/ready-CP term and discount positive `powerBonus` when it cannot affect combat before expiry—especially Main Phase 2. Add “pass over useless Red Mage” and “pass over unusable Undead Princess pump” tests.
 19807	
 19808	---
 19809	
 19810	**Use stable `abilityId`, not an index into the implemented ability array.**
 19811	
 19812	`Ability.id` already exists specifically as a stable per-clause identity (`packages/engine/src/abilities.ts:121-131`). Miner’s action is its printed second clause, but its deferred ETB is currently absent (`packages/cards/src/abilities.ts:40`). If the action is installed alone it occupies array index 0; adding the deck-knowledge ETB later shifts it. That is precisely rework created by the rung reordering.
 19813	
 19814	**Fix:** Use `abilityId` in commands, frames, action keys, logs, and tests. Printed order remains the order of `def.abilities`; command identity must not depend on that position.
 19815	
 19816	---
 19817	
 19818	**Source zone belongs in the action-ability definition now.**
 19819	
 19820	`Ability` currently has only a mandatory trigger and effects (`packages/engine/src/abilities.ts:121-132`), while the spec leaves the source-zone question unresolved (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:100-105`). Hard-coding `legalCommands` to scan fields will require another availability model immediately for the two hand abilities and again for Break-Zone abilities.
 19821	
 19822	**Fix:** Add an action discriminant containing at least `sourceZone: 'field' | 'hand' | 'breakZone'` and cost metadata. Zone is an activation precondition, not part of the cost. Leave timing and once-per-turn extensions additive, but do not infer the source zone from a particular cost.
 19823	
 19824	---
 19825	
 19826	**The browser receives legal activations, but its usable one-choice UI does not come for free.**
 19827	
 19828	The board already renders any field card appearing in `choices.byCard` as clickable (`apps/web/src/ui/Board.tsx:17-43`), so `Board.tsx` needs no special-case UI. But `describeChoice`, `subjectsOf`, and `sameCommand` have exhaustive command handling with no activation (`apps/web/src/game/commands.ts:225-254`, `:295-310`, `:349-369`). More importantly, `preferredChoices` collapses payment variants only for casts (`:372-420`); Red Mage or Miner would expose every enumerated payment as separate buttons.
 19829	
 19830	**Fix:** Treat casts and activations as “payable commands” for payment collapsing, attach an activation to its source card in `subjectsOf`, compare `source + abilityId + targets + payment`, and render the printed cost plus chosen CP sources. Emit/narrate `abilityActivated`, not `abilityTriggered`; the latter currently produces “ability triggers” (`apps/web/src/game/useGame.ts:77-80`).
 19831	
 19832	---
 19833	
 19834	**C3-A6 misunderstands `ABILITY_CLAUSES`.**
 19835	
 19836	`ABILITY_CLAUSES` stores the total number of printed clauses, implemented or not (`packages/cards/src/abilities.ts:21-30`). It must not “drop by four” as required by the spec (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:95-96`). Reducing Miner or Undead Princess from two to one would falsely hide their remaining deferred clauses. Missing warnings are derived from total minus `def.abilities.length` (`packages/engine/src/cast.ts:45-51`).
 19837	
 19838	**Fix:** Keep every `ABILITY_CLAUSES` value unchanged. Assert that implemented AST count rises by four and the derived missing count falls by four.
 19839	
 19840	## MINOR
 19841	
 19842	**The two principal CR citations are wrong.**
 19843	
 19844	CR §1 contains only the game-scope rule; cost atomicity is §11.6.10, activation procedure is §§11.6.3–11.6.11, and source independence is §11.5.4. The `[Dull]` control/Haste rule is §11.6.2.2, not §9.3.2 (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:54-55`). The cost-versus-break distinction is §15.1.1.3.2. [Official CR 3.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19845	
 19846	**Fix:** Replace the citations before turning them into code comments or test names.
 19847	
 19848	---
 19849	
 19850	**CR 3.3 permits over-generation, not overpayment.**
 19851	
 19852	`cp.ts` says `apply` accepts overpayment (`packages/engine/src/cp.ts:54`), but CR §11.2.2.3 permits generating arbitrary CP, selecting exactly the required CP, and losing the remainder. The current `cp.length >= cost` representation can model this implicitly, but its terminology is misleading. [CR 3.3 §11.2.2.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19853	
 19854	**Fix:** Document `Payment` as generated sources and `canPay` as proving a usable subset exists; call extras “unused generated CP.”
 19855	
 19856	---
 19857	
 19858	**The seeded reachability sweep is not enough for the new legality boundary.**
 19859	
 19860	C3-A1 emphasizes driven games (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:80-82`), but rare combinations—fresh Noel with Haste, dull Undead Princess, no legal non-source target, cost-triggered Lightning—are unlikely to occur reliably.
 19861	
 19862	**Fix:** Keep the sweep, but add constructed unit tests for every legality predicate, payment exclusion, transition reason, watcher order, and target-before-cost rollback.
 19863	
 19864	## WHAT I WOULD DO DIFFERENTLY
 19865	
 19866	**Keep activated abilities ahead of deck knowledge; the reordering is right.**
 19867	
 19868	Deck knowledge still requires durable knowledge ownership, pending reconstruction, two search identities, and observer-relative narration (`docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:9-31`). None of the activation fixes above entangles determinisation with private information.
 19869	
 19870	**Fix:** Keep deck knowledge deferred, but soften “eight clauses behind one primitive”: activation also needs target declaration, generalized costs, a draw effect, command codecs, and timing policy.
 19871	
 19872	---
 19873	
 19874	**Build the activation substrate first, then land cards in two small stages.**
 19875	
 19876	The dangerous seam is not any individual AST; it is the transaction from activation declaration through simultaneous costs, cost triggers, and queued resolution (`packages/engine/src/apply.ts:25-57`).
 19877	
 19878	**Fix:** Stage 1: action metadata/source zone, stable command identity, target preflight, generalized CP, atomic cost transitions, draw, agenda ordering, AI/UI codecs. Stage 2: Red Mage, Noel, Miner, and Undead Princess plus the adversarial tests.
 19879	
 19880	---
 19881	
 19882	**I would pull the two hand-sourced draw abilities into a short follow-up—or into this rung if scope allows.**
 19883	
 19884	Once Miner forces `draw` and generalized action CP, Geomancer and Red Mage need only `sourceZone: 'hand'` plus `selfDiscard` (`packages/cards/data/cards.json:79-105`). They reveal themselves by immediately moving to the public Break Zone, so they do not require C6’s durable knowledge model. By contrast, Undead Princess’s second clause requires a new removed-from-play zone (`packages/engine/src/state.ts:16-23`), and Sphene requires field-to-Break-Zone history and once-per-turn state (`packages/cards/data/cards.json:245-257`).
 19885	
 19886	**Fix:** Make source zone first-class now; preferably use the two hand clauses to prove it. Leave Break-Zone Undead Princess and Sphene in C4.
 19887	tokens used
 19888	231,577
 19889	## BLOCKER
 19890	
 19891	**`Payment` is reusable, but the existing cast payment validator is not.**
 19892	
 19893	`Payment` is only a description of CP sources (`packages/engine/src/commands.ts:4`), so retaining it is sound. But casting derives the amount and required Elements from the card definition (`packages/engine/src/cast.ts:33-37`), while Red Mage needs `1 + Lightning` despite having printed cost 2 (`packages/cards/data/cards.json:3-14`), and Miner needs generic 2—not Earth—despite having printed cost 3 (`packages/cards/data/cards.json:140-151`). `generateCp` also excludes `casting` only from discards (`packages/engine/src/cp.ts:33-35`), not from dulled Backups (`packages/engine/src/cp.ts:24-32`). Both Red Mage and Miner can therefore generate CP with themselves while also paying their `[Dull]`/self-break costs.
 19894	
 19895	**Fix:** Keep `Payment`, but generalize the machinery around it to accept `{ amount, requiredElements, excludedSources }`. Apply exclusions to both Backup and discard sources, and use the same API from casting, enumeration, `preferredPayment`, and activation. Encode requirements as an Element array, not singular `element?`, so repeated/multi-Element costs do not require another fork. Generic `[2]` is `{ amount: 2, requiredElements: [] }`; `[Lightning]` is `{ amount: 1, requiredElements: ['lightning'] }`; `[0]` produces only the empty payment.
 19896	
 19897	---
 19898	
 19899	**The proposed command omits activation-time target legality, allowing a player to pay a cost for an ability they cannot activate.**
 19900	
 19901	`resolve.ts` currently discovers targets after a frame starts and treats an empty set as a successful no-op (`packages/engine/src/resolve.ts:235-240`). That is correct for triggered abilities, but CR §11.6.5 says a targeted action ability needs a legal target before activation and cannot choose itself. Without a preflight, Undead Princess can break herself when she is the only Forward and get nothing; if checked before payment without `excludeSource`, she can illegally count herself as the target. [CR 3.3 §11.6.5](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19902	
 19903	**Fix:** Make activation choices part of the activation transaction. Prefer `activateAbility { player, source, abilityId, payment, targets }`, validate targets against the pre-cost state with the source excluded, and initialize `Frame.chosen` accordingly. At minimum, preflight and snapshot the eligible set before payment; do not reuse the triggered-ability “no legal target → no-op” path.
 19904	
 19905	---
 19906	
 19907	**C3-A3 wrongly applies `[Dull]` restrictions to Undead Princess.**
 19908	
 19909	The acceptance criterion says any dulled or newly entered source is illegal (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:86-89`), but those restrictions apply only when the cost contains the dull icon. Undead Princess’s first clause has only a self-to-Break-Zone cost (`packages/cards/data/cards.json:125-136`), so she may use it while dull and on the turn she enters. CR §11.6.2.2 applies the control-since-start/Haste rule specifically to abilities with `[Dull]`. [CR 3.3 §11.6.2.2](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19910	
 19911	**Fix:** Gate active status, `enteredTurn`, and the Haste exception on `cost.dull === true`. Add positive tests that a dull/fresh Undead Princess can activate and that a fresh Noel with Haste can activate.
 19912	
 19913	---
 19914	
 19915	**C3-A4 contradicts C3-4: a self-break cost must trigger Lightning’s zone-movement watcher.**
 19916	
 19917	C3-4 says the cost produces a `ZoneTransition` visible to C2 observers (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:56`), while C3-A4 says the observer must not fire (`:90-92`). The implemented observer is not “when broken”; its exact text is “put from the field into the Break Zone” (`packages/cards/src/abilities.ts:218-226`), and `watches` intentionally ignores `ZoneTransition.reason` (`packages/engine/src/resolve.ts:519-528`). It therefore must see Noel or Undead Princess paying this cost. What must not happen is a `broken`, `brokenByAbility`, or `breakPrevented` event. CR §15.1.1.3.2 explicitly says putting a card into the Break Zone as a cost is not breaking. [CR 3.3 §15.1.1.3.2](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19918	
 19919	There is also an ordering requirement. `drainResolution` consumes its queue FIFO (`packages/engine/src/resolve.ts:413-430`). Cost-triggered auto-abilities go above the already-declared action ability and resolve first. Merely “pay, then push the frame” works only if the cost watcher frames are enqueued before the action frame.
 19920	
 19921	**Fix:** Add `ZoneTransition.reason: 'cost'`. Snapshot the action frame’s source, controller, ability, targets, and the transition’s pre-cost `FieldCard` before mutation; apply every cost simultaneously; call `enqueueZoneChangeTriggers(pre, post, transitions)`; then append the action frame. True zone-movement observers fire; future explicitly “broken” observers filter out `reason: 'cost'`. Change `describeTriggerCause`, which currently says every zone move “was broken” (`apps/web/src/game/commands.ts:60-63`), to the accurate “was put into the Break Zone.”
 19922	
 19923	---
 19924	
 19925	**Miner’s effect cannot be represented by the current AST.**
 19926	
 19927	`Effect` has no draw operation (`packages/engine/src/abilities.ts:53-73`). The only draw primitive is in `phases.ts` (`packages/engine/src/phases.ts:10-18`), while `resolve.ts` deliberately cannot import `phases.ts` because `phases.ts` already imports it (`packages/engine/src/resolve.ts:16-19`, `packages/engine/src/phases.ts:8`). The claim that all four effect halves need no new machinery is therefore false.
 19928	
 19929	**Fix:** Add `{ kind: 'draw'; count: number }`, extract `drawCards` into a neutral module imported by both phases and resolution, and preserve its empty-deck loss semantics.
 19930	
 19931	## MAJOR
 19932	
 19933	**Main-phase-only activation is a real gameplay deviation, not merely a restatement of the current priority model.**
 19934	
 19935	The CR permits action abilities in both Main and Attack Phases (`packages/engine/src/state.ts:47`; [CR 3.3 §9.3.1.7](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)). The engine actually has an unblocked turn-player action point during attack declaration (`packages/engine/src/legal.ts:68-72`), although it immediately resolves damage after a block and exposes no combat response window (`packages/engine/src/attack.ts:87-95`).
 19936	
 19937	Noel and Red Mage still work before the first attack from Main Phase 1. Undead Princess does not work as the printed combat trick: she cannot pump after blockers, nor attack and then sacrifice herself to help a later attacker.
 19938	
 19939	**Fix:** Either allow activation during attack declaration now and explicitly defer post-attack/block response windows, or retain main-only activation but document it as “action abilities are sorcery-speed; Undead Princess cannot be used as a combat trick.” Do not claim there is no further loss of fidelity.
 19940	
 19941	---
 19942	
 19943	**The AI does not receive activations “for free.”**
 19944	
 19945	`candidateCommands` manually emits casts and pass in Main Phases (`packages/ai/src/candidates.ts:295-302`); SO-ISMCTS searches that list (`packages/ai/src/ismcts/search.ts:369`). An activation added only to `legalCommands` will never be considered by either agent. Action keys, decoding, and synthetic-ID guards also need explicit variants (`packages/ai/src/ismcts/keys.ts:202-237`, `packages/ai/src/ismcts/keys.ts:267-334`, `packages/ai/src/greedy.ts:186-199`).
 19946	
 19947	The evaluation has two predictable mistakes:
 19948	
 19949	- Backup status contributes nothing to material (`packages/ai/src/evaluate.ts:95-96`), so dulling Red Mage and other CP Backups can look free.
 19950	- With the current weights, losing active 2000-power Undead Princess is worth exactly 8, and giving another active Forward +4000 is also worth exactly 8 (`packages/ai/src/evaluate.ts:21-34`, `packages/ai/src/evaluate.ts:87-93`). Greedy retains the earlier command on a tie (`packages/ai/src/greedy.ts:95-107`), so activation ordering can make it sacrifice a body for a transient pump with no demonstrated payoff.
 19951	
 19952	**Fix:** Explicitly generate one preferred-payment activation per `(source, abilityId, target set)`, add the ISMCTS codec/ID plumbing, and test that both agents actually choose an activation. Add a small active-Backup/ready-CP term and discount positive `powerBonus` when it cannot affect combat before expiry—especially Main Phase 2. Add “pass over useless Red Mage” and “pass over unusable Undead Princess pump” tests.
 19953	
 19954	---
 19955	
 19956	**Use stable `abilityId`, not an index into the implemented ability array.**
 19957	
 19958	`Ability.id` already exists specifically as a stable per-clause identity (`packages/engine/src/abilities.ts:121-131`). Miner’s action is its printed second clause, but its deferred ETB is currently absent (`packages/cards/src/abilities.ts:40`). If the action is installed alone it occupies array index 0; adding the deck-knowledge ETB later shifts it. That is precisely rework created by the rung reordering.
 19959	
 19960	**Fix:** Use `abilityId` in commands, frames, action keys, logs, and tests. Printed order remains the order of `def.abilities`; command identity must not depend on that position.
 19961	
 19962	---
 19963	
 19964	**Source zone belongs in the action-ability definition now.**
 19965	
 19966	`Ability` currently has only a mandatory trigger and effects (`packages/engine/src/abilities.ts:121-132`), while the spec leaves the source-zone question unresolved (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:100-105`). Hard-coding `legalCommands` to scan fields will require another availability model immediately for the two hand abilities and again for Break-Zone abilities.
 19967	
 19968	**Fix:** Add an action discriminant containing at least `sourceZone: 'field' | 'hand' | 'breakZone'` and cost metadata. Zone is an activation precondition, not part of the cost. Leave timing and once-per-turn extensions additive, but do not infer the source zone from a particular cost.
 19969	
 19970	---
 19971	
 19972	**The browser receives legal activations, but its usable one-choice UI does not come for free.**
 19973	
 19974	The board already renders any field card appearing in `choices.byCard` as clickable (`apps/web/src/ui/Board.tsx:17-43`), so `Board.tsx` needs no special-case UI. But `describeChoice`, `subjectsOf`, and `sameCommand` have exhaustive command handling with no activation (`apps/web/src/game/commands.ts:225-254`, `:295-310`, `:349-369`). More importantly, `preferredChoices` collapses payment variants only for casts (`:372-420`); Red Mage or Miner would expose every enumerated payment as separate buttons.
 19975	
 19976	**Fix:** Treat casts and activations as “payable commands” for payment collapsing, attach an activation to its source card in `subjectsOf`, compare `source + abilityId + targets + payment`, and render the printed cost plus chosen CP sources. Emit/narrate `abilityActivated`, not `abilityTriggered`; the latter currently produces “ability triggers” (`apps/web/src/game/useGame.ts:77-80`).
 19977	
 19978	---
 19979	
 19980	**C3-A6 misunderstands `ABILITY_CLAUSES`.**
 19981	
 19982	`ABILITY_CLAUSES` stores the total number of printed clauses, implemented or not (`packages/cards/src/abilities.ts:21-30`). It must not “drop by four” as required by the spec (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:95-96`). Reducing Miner or Undead Princess from two to one would falsely hide their remaining deferred clauses. Missing warnings are derived from total minus `def.abilities.length` (`packages/engine/src/cast.ts:45-51`).
 19983	
 19984	**Fix:** Keep every `ABILITY_CLAUSES` value unchanged. Assert that implemented AST count rises by four and the derived missing count falls by four.
 19985	
 19986	## MINOR
 19987	
 19988	**The two principal CR citations are wrong.**
 19989	
 19990	CR §1 contains only the game-scope rule; cost atomicity is §11.6.10, activation procedure is §§11.6.3–11.6.11, and source independence is §11.5.4. The `[Dull]` control/Haste rule is §11.6.2.2, not §9.3.2 (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:54-55`). The cost-versus-break distinction is §15.1.1.3.2. [Official CR 3.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19991	
 19992	**Fix:** Replace the citations before turning them into code comments or test names.
 19993	
 19994	---
 19995	
 19996	**CR 3.3 permits over-generation, not overpayment.**
 19997	
 19998	`cp.ts` says `apply` accepts overpayment (`packages/engine/src/cp.ts:54`), but CR §11.2.2.3 permits generating arbitrary CP, selecting exactly the required CP, and losing the remainder. The current `cp.length >= cost` representation can model this implicitly, but its terminology is misleading. [CR 3.3 §11.2.2.3](https://fftcg.cdn.sewest.net/2026-08/fftcg-comprules-v3.3.pdf)
 19999	
 20000	**Fix:** Document `Payment` as generated sources and `canPay` as proving a usable subset exists; call extras “unused generated CP.”
 20001	
 20002	---
 20003	
 20004	**The seeded reachability sweep is not enough for the new legality boundary.**
 20005	
 20006	C3-A1 emphasizes driven games (`docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:80-82`), but rare combinations—fresh Noel with Haste, dull Undead Princess, no legal non-source target, cost-triggered Lightning—are unlikely to occur reliably.
 20007	
 20008	**Fix:** Keep the sweep, but add constructed unit tests for every legality predicate, payment exclusion, transition reason, watcher order, and target-before-cost rollback.
 20009	
 20010	## WHAT I WOULD DO DIFFERENTLY
 20011	
 20012	**Keep activated abilities ahead of deck knowledge; the reordering is right.**
 20013	
 20014	Deck knowledge still requires durable knowledge ownership, pending reconstruction, two search identities, and observer-relative narration (`docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:9-31`). None of the activation fixes above entangles determinisation with private information.
 20015	
 20016	**Fix:** Keep deck knowledge deferred, but soften “eight clauses behind one primitive”: activation also needs target declaration, generalized costs, a draw effect, command codecs, and timing policy.
 20017	
 20018	---
 20019	
 20020	**Build the activation substrate first, then land cards in two small stages.**
 20021	
 20022	The dangerous seam is not any individual AST; it is the transaction from activation declaration through simultaneous costs, cost triggers, and queued resolution (`packages/engine/src/apply.ts:25-57`).
 20023	
 20024	**Fix:** Stage 1: action metadata/source zone, stable command identity, target preflight, generalized CP, atomic cost transitions, draw, agenda ordering, AI/UI codecs. Stage 2: Red Mage, Noel, Miner, and Undead Princess plus the adversarial tests.
 20025	
 20026	---
 20027	
 20028	**I would pull the two hand-sourced draw abilities into a short follow-up—or into this rung if scope allows.**
 20029	
 20030	Once Miner forces `draw` and generalized action CP, Geomancer and Red Mage need only `sourceZone: 'hand'` plus `selfDiscard` (`packages/cards/data/cards.json:79-105`). They reveal themselves by immediately moving to the public Break Zone, so they do not require C6’s durable knowledge model. By contrast, Undead Princess’s second clause requires a new removed-from-play zone (`packages/engine/src/state.ts:16-23`), and Sphene requires field-to-Break-Zone history and once-per-turn state (`packages/cards/data/cards.json:245-257`).
 20031	
 20032	**Fix:** Make source zone first-class now; preferably use the two hand clauses to prove it. Leave Break-Zone Undead Princess and Sphene in C4.
 20033	exit=0

exec
/bin/zsh -lc 'git diff --stat 6f86fde..HEAD && git diff --name-only 6f86fde..HEAD && wc -l packages/engine/src/{activate,cp,draw,abilities,commands,legal,apply,rules,resolve,cast}.ts packages/cards/src/abilities.ts packages/ai/src/{candidates,payment,evaluate}.ts packages/ai/src/ismcts/keys.ts apps/web/src/game/{commands,useGame}.ts packages/engine/test/activated-abilities.test.ts packages/ai/test/greedy.test.ts apps/web/test/commands.test.ts apps/cli/test/agents.test.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ttfoN9Mi' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Q0ktxFgC' (errno=Operation not permitted)
 apps/cli/src/render.ts                           |  13 ++
 apps/cli/src/weights-ab.ts                       |  59 +++++
 apps/cli/test/agents.test.ts                     |  42 ++++
 apps/web/src/game/commands.ts                    |  92 ++++++--
 apps/web/src/game/useGame.ts                     |  19 +-
 apps/web/test/commands.test.ts                   |  62 +++++-
 apps/web/test/useGame.test.ts                    |  25 ++-
 packages/ai/src/candidates.ts                    |  31 ++-
 packages/ai/src/evaluate.ts                      |  23 +-
 packages/ai/src/greedy.ts                        |   2 +
 packages/ai/src/ismcts/agent.ts                  |   1 +
 packages/ai/src/ismcts/keys.ts                   |  22 ++
 packages/ai/src/payment.ts                       |  32 ++-
 packages/ai/test/greedy.test.ts                  |  51 ++++-
 packages/ai/test/ismcts-keys.test.ts             |   4 +-
 packages/cards/src/abilities.ts                  | 112 +++++++++-
 packages/cards/test/abilities.test.ts            |  38 +++-
 packages/engine/src/abilities.ts                 |  75 ++++++-
 packages/engine/src/activate.ts                  | 187 ++++++++++++++++
 packages/engine/src/apply.ts                     |   3 +
 packages/engine/src/commands.ts                  |  17 ++
 packages/engine/src/cp.ts                        |  60 ++++-
 packages/engine/src/draw.ts                      |  27 +++
 packages/engine/src/events.ts                    |   7 +
 packages/engine/src/index.ts                     |   4 +-
 packages/engine/src/legal.ts                     |  28 ++-
 packages/engine/src/phases.ts                    |  13 +-
 packages/engine/src/resolve.ts                   |  12 +-
 packages/engine/src/rules.ts                     |  13 +-
 packages/engine/test/activated-abilities.test.ts | 267 +++++++++++++++++++++++
 packages/engine/test/observer-triggers.test.ts   |   5 +-
 31 files changed, 1253 insertions(+), 93 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-4xe5qQCo' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Ea5KM06p' (errno=Operation not permitted)
apps/cli/src/render.ts
apps/cli/src/weights-ab.ts
apps/cli/test/agents.test.ts
apps/web/src/game/commands.ts
apps/web/src/game/useGame.ts
apps/web/test/commands.test.ts
apps/web/test/useGame.test.ts
packages/ai/src/candidates.ts
packages/ai/src/evaluate.ts
packages/ai/src/greedy.ts
packages/ai/src/ismcts/agent.ts
packages/ai/src/ismcts/keys.ts
packages/ai/src/payment.ts
packages/ai/test/greedy.test.ts
packages/ai/test/ismcts-keys.test.ts
packages/cards/src/abilities.ts
packages/cards/test/abilities.test.ts
packages/engine/src/abilities.ts
packages/engine/src/activate.ts
packages/engine/src/apply.ts
packages/engine/src/commands.ts
packages/engine/src/cp.ts
packages/engine/src/draw.ts
packages/engine/src/events.ts
packages/engine/src/index.ts
packages/engine/src/legal.ts
packages/engine/src/phases.ts
packages/engine/src/resolve.ts
packages/engine/src/rules.ts
packages/engine/test/activated-abilities.test.ts
packages/engine/test/observer-triggers.test.ts
     187 packages/engine/src/activate.ts
     147 packages/engine/src/cp.ts
      27 packages/engine/src/draw.ts
     266 packages/engine/src/abilities.ts
      36 packages/engine/src/commands.ts
     105 packages/engine/src/legal.ts
      91 packages/engine/src/apply.ts
     126 packages/engine/src/rules.ts
     604 packages/engine/src/resolve.ts
      96 packages/engine/src/cast.ts
     445 packages/cards/src/abilities.ts
     335 packages/ai/src/candidates.ts
     123 packages/ai/src/payment.ts
     129 packages/ai/src/evaluate.ts
     539 packages/ai/src/ismcts/keys.ts
     481 apps/web/src/game/commands.ts
     407 apps/web/src/game/useGame.ts
     267 packages/engine/test/activated-abilities.test.ts
     596 packages/ai/test/greedy.test.ts
     495 apps/web/test/commands.test.ts
     146 apps/cli/test/agents.test.ts
    5648 total

exec
/bin/zsh -lc 'nl -ba packages/engine/src/activate.ts && nl -ba packages/engine/src/cp.ts && nl -ba packages/engine/src/commands.ts && nl -ba packages/engine/src/legal.ts && nl -ba packages/engine/src/apply.ts && nl -ba packages/engine/src/rules.ts && nl -ba packages/engine/src/draw.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { PlayerId } from './types.js'
     2	import type { CardId, FieldCard, GameState } from './state.js'
     3	import { defOf, findFieldCard, updatePlayer } from './state.js'
     4	import type { Ability, AbilityCost } from './abilities.js'
     5	import type { Payment } from './commands.js'
     6	import type { Event } from './events.js'
     7	import { IllegalCommandError } from './errors.js'
     8	import { canPay, generateCp, pay, type CpRequirement } from './cp.js'
     9	import type { ZoneTransition } from './rules.js'
    10	import { enqueueTrigger, enqueueZoneChangeTriggers, removeFromField, targetCandidates } from './resolve.js'
    11	
    12	/**
    13	 * Activated abilities (spec C3): the transaction from declaration through simultaneous costs, cost triggers,
    14	 * and the queued action frame.
    15	 *
    16	 * The order in here is the whole point and is not arbitrary:
    17	 *
    18	 *   1. check legality — including a PREFLIGHT of the ability's targets against the POST-cost state;
    19	 *   2. pay every cost at once (§11.6.10) — there is no partial payment;
    20	 *   3. enqueue the triggers the COSTS fired;
    21	 *   4. enqueue the action frame LAST.
    22	 *
    23	 * Step 3 before step 4 because `drainResolution` is FIFO: an ability whose cost puts its own source into the
    24	 * Break Zone fires observers that must resolve above the action that paid for them.
    25	 */
    26	
    27	/** The CP half of an ability's cost, as a requirement independent of the card's printed cost (spec C3-4). */
    28	export function abilityCpRequirement(source: CardId, cost: AbilityCost): CpRequirement {
    29	  return {
    30	    amount: cost.cp?.amount ?? 0,
    31	    requiredElements: cost.cp?.requiredElements ?? [],
    32	    // The source can never help pay for itself — see `generateCp`.
    33	    excluded: [source],
    34	  }
    35	}
    36	
    37	/** Locate an activated clause by its stable id. Returns null when the card has no such clause. */
    38	export function activatedAbility(state: GameState, source: CardId, abilityId: string): Ability | null {
    39	  const def = defOf(state, source)
    40	  const ability = (def.abilities ?? []).find((a) => a.id === abilityId)
    41	  if (!ability || ability.trigger.kind !== 'activated') return null
    42	  return ability
    43	}
    44	
    45	/** Where the card actually is, from the activating player's side only. */
    46	function sourceZoneOf(state: GameState, player: PlayerId, source: CardId): 'field' | 'hand' | 'breakZone' | null {
    47	  const ps = state.players[player]
    48	  if (ps.hand.includes(source)) return 'hand'
    49	  if (ps.breakZone.includes(source)) return 'breakZone'
    50	  const loc = findFieldCard(state, source)
    51	  if (loc && loc.owner === player) return 'field'
    52	  return null
    53	}
    54	
    55	function hasHaste(state: GameState, card: FieldCard): boolean {
    56	  return card.granted.includes('haste') || defOf(state, card.id).keywords.includes('haste')
    57	}
    58	
    59	/**
    60	 * Why this activation is illegal, or null. Mirrors `castCheck`: `legalCommands` uses it to enumerate and
    61	 * `apply` uses it to reject, so the two can never disagree.
    62	 */
    63	export function activationCheck(state: GameState, player: PlayerId, source: CardId, abilityId: string): string | null {
    64	  if (state.result) return 'the game is over'
    65	  // A decision is owed; nothing else may happen until it is answered.
    66	  if (state.pending) return 'a decision is pending'
    67	  // MVP0-SIMPLIFICATION (spec C3-11): action abilities are sorcery-speed here — the turn player, in a Main
    68	  // Phase, only. The real rules (§9.3.1.7) also allow the Attack Phase, so this DOES cost something: Undead
    69	  // Princess cannot be used as a combat trick after blockers are declared. `priority` is always the turn
    70	  // player in MVP0, so no non-turn-player window is being lost, but that is not the same as losing nothing.
    71	  if (state.turnPlayer !== player) return 'you may only use abilities on your own turn'
    72	  if (state.phase !== 'main1' && state.phase !== 'main2') return 'you may only use abilities in a Main Phase'
    73	
    74	  const ability = activatedAbility(state, source, abilityId)
    75	  if (!ability || ability.trigger.kind !== 'activated') return `${abilityId} is not an activated ability of ${source}`
    76	  const { sourceZone, cost } = ability.trigger
    77	
    78	  const where = sourceZoneOf(state, player, source)
    79	  if (where === null) return `you do not have ${source}`
    80	  if (where !== sourceZone) return `${abilityId} may only be used from your ${sourceZone}`
    81	
    82	  if (cost.dull) {
    83	    // §11.6.2.2 — the dull icon, and ONLY the dull icon, brings the active/entered-this-turn/Haste rule with
    84	    // it. An ability without it (Undead Princess) is usable while dulled and on the turn its source arrives.
    85	    const loc = findFieldCard(state, source)
    86	    if (!loc) return 'only a card on the field can be dulled'
    87	    if (loc.card.status !== 'active') return `${source} is already dull`
    88	    if (loc.card.enteredTurn === state.turn && !hasHaste(state, loc.card)) {
    89	      return `${source} entered the field this turn (§11.6.2.2)`
    90	    }
    91	  }
    92	  if (cost.selfToBreakZone && !findFieldCard(state, source)) return 'only a card on the field can be put into the Break Zone'
    93	  if (cost.selfDiscard && !state.players[player].hand.includes(source)) return 'only a card in your hand can be discarded'
    94	
    95	  // Preflight the targets against the state as it will be AFTER the costs are paid (§11.6.5).
    96	  const [post] = applyCosts(state, player, source, cost, { dullBackups: [], discards: [] }, /* validate */ false)
    97	  const first = ability.effects[0]
    98	  if (first?.kind === 'chooseTargets') {
    99	    const candidates = targetCandidates(post, source, player, first.from)
   100	    if (candidates.length === 0 || first.min > candidates.length) return `${abilityId} has no legal target`
   101	  }
   102	  return null
   103	}
   104	
   105	/**
   106	 * Apply every non-CP cost, plus (when `validate`) the CP payment. Returns the new state, its events, and any
   107	 * zone transitions the cost produced.
   108	 *
   109	 * Used twice: once with an empty payment and `validate: false` to preflight targets, and once for real. The
   110	 * preflight deliberately skips CP because CP does not move the source card and so cannot change who is a
   111	 * legal target.
   112	 */
   113	function applyCosts(
   114	  state: GameState, player: PlayerId, source: CardId, cost: AbilityCost, payment: Payment, validate: boolean,
   115	): [GameState, Event[], ZoneTransition[]] {
   116	  let s = state
   117	  const events: Event[] = []
   118	  const transitions: ZoneTransition[] = []
   119	
   120	  if (validate) {
   121	    const req = abilityCpRequirement(source, cost)
   122	    const cp = generateCp(s, player, payment, req.excluded)
   123	    if (!canPay(req.amount, req.requiredElements, cp)) {
   124	      throw new IllegalCommandError(`payment does not cover cost ${req.amount} ${req.requiredElements.join('/')}`)
   125	    }
   126	    const [paid, payEvents] = pay(s, player, payment)
   127	    s = paid
   128	    events.push(...payEvents)
   129	  }
   130	
   131	  if (cost.dull) {
   132	    s = setStatus(s, source, 'dull')
   133	    events.push({ type: 'activated', player, cards: [source] })
   134	  }
   135	  if (cost.selfToBreakZone) {
   136	    const loc = findFieldCard(s, source)
   137	    if (loc) {
   138	      // NOT a break (§15.1.1.3.2): `cannotBeBroken` is not consulted and no `broken` event is emitted. It IS
   139	      // a zone movement, so the transition is produced and observers of "put from the field into the Break
   140	      // Zone" — which is the printed wording the implemented watcher encodes — still see it (spec C3-7).
   141	      const owner = s.cards[source]?.owner ?? loc.owner
   142	      transitions.push({
   143	        card: source, controller: loc.owner, owner,
   144	        from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'cost',
   145	        cause: source, causeController: player, snapshot: loc.card,
   146	      })
   147	      s = updatePlayer(removeFromField(s, source), owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
   148	      events.push({ type: 'paidToBreakZone', player, card: source })
   149	    }
   150	  }
   151	  if (cost.selfDiscard) {
   152	    const owner = s.cards[source]?.owner ?? player
   153	    s = updatePlayer(s, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== source) }))
   154	    s = updatePlayer(s, owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
   155	    events.push({ type: 'discarded', player, card: source, reason: 'cp' })
   156	  }
   157	  return [s, events, transitions]
   158	}
   159	
   160	function setStatus(state: GameState, card: CardId, status: 'active' | 'dull'): GameState {
   161	  const loc = findFieldCard(state, card)
   162	  if (!loc) return state
   163	  return updatePlayer(state, loc.owner, (ps) => ({
   164	    ...ps,
   165	    forwards: ps.forwards.map((c) => (c.id === card ? { ...c, status } : c)),
   166	    backups: ps.backups.map((c) => (c.id === card ? { ...c, status } : c)),
   167	  }))
   168	}
   169	
   170	export function applyActivateAbility(
   171	  state: GameState, player: PlayerId, source: CardId, abilityId: string, payment: Payment,
   172	): [GameState, Event[]] {
   173	  const why = activationCheck(state, player, source, abilityId)
   174	  if (why) throw new IllegalCommandError(why)
   175	  const ability = activatedAbility(state, source, abilityId)
   176	  if (!ability || ability.trigger.kind !== 'activated') throw new IllegalCommandError('unreachable: checked above')
   177	
   178	  const pre = state   // observers are read PRE-move, exactly as `breakCard` does
   179	  const [paid, events, transitions] = applyCosts(state, player, source, ability.trigger.cost, payment, true)
   180	  events.unshift({ type: 'abilityActivated', player, card: source, abilityId })
   181	
   182	  // Cost triggers BEFORE the action frame: `drainResolution` is FIFO, and the observers a cost fires resolve
   183	  // above the ability that paid them (spec C3-8).
   184	  let s = enqueueZoneChangeTriggers(pre, paid, transitions)
   185	  s = enqueueTrigger(s, source, player, ability)
   186	  return [s, events]
   187	}
     1	import type { CardDef, Element, PlayerId } from './types.js'
     2	import type { CardId, GameState } from './state.js'
     3	import { defOf, updatePlayer } from './state.js'
     4	import type { Payment } from './commands.js'
     5	import type { Event } from './events.js'
     6	import { IllegalCommandError } from './errors.js'
     7	
     8	/** §11.2.1.1/§11.2.2: a pure Light or pure Dark card needs no CP of its own element — its cost may be paid entirely
     9	 *  with off-element CP. Every other card (including a Light/Dark card combined with another element, none in the
    10	 *  MVP0 pool) still requires ≥1 CP of each of its listed elements. Callers pass this — not `def.elements` directly
    11	 *  — to `canPay` and to `preferredPayment`'s required-element phase. */
    12	export function requiredElements(def: CardDef): Element[] {
    13	  if (def.elements.length === 1 && (def.elements[0] === 'light' || def.elements[0] === 'dark')) return []
    14	  return def.elements
    15	}
    16	
    17	export interface GeneratedCp { element: Element; source: CardId }
    18	
    19	/**
    20	 * Validate the sources and compute the CP they generate. Throws IllegalCommandError on a bad source.
    21	 *
    22	 * `excluded` is the card (or cards) that may not be a CP source for this payment. For a cast that is the card
    23	 * being cast; for an activated ability it is the ability's own source (spec C3-5), and there it matters in a
    24	 * way it never did for casting: Red Mage's `[Lightning][Dull]` would otherwise let Red Mage dull ITSELF to
    25	 * produce its own Lightning CP while that same dull also paid the `[Dull]` cost — one action, two costs. The
    26	 * exclusion used to be applied to discards only, which was invisible while the only caller was casting (the
    27	 * card being cast is in hand, so it could never be a dulled Backup anyway).
    28	 */
    29	export function generateCp(state: GameState, player: PlayerId, payment: Payment, excluded: CardId | readonly CardId[]): GeneratedCp[] {
    30	  const forbidden = typeof excluded === 'number' ? [excluded] : excluded
    31	  const ps = state.players[player]
    32	  const cp: GeneratedCp[] = []
    33	  const seen = new Set<CardId>()
    34	  for (const id of payment.dullBackups) {
    35	    const b = ps.backups.find((c) => c.id === id)
    36	    if (!b) throw new IllegalCommandError(`${id} is not a backup you control`)
    37	    if (forbidden.includes(id)) throw new IllegalCommandError(`${id} cannot pay for its own ability`)
    38	    if (b.status !== 'active') throw new IllegalCommandError(`backup ${id} is already dull`)
    39	    if (seen.has(id)) throw new IllegalCommandError(`backup ${id} used twice`)
    40	    seen.add(id)
    41	    const def = defOf(state, id)
    42	    cp.push({ element: def.elements[0] as Element, source: id })   // MVP0-SIMPLIFICATION: multi-element backups produce their first element; none in pool
    43	  }
    44	  for (const { card, element } of payment.discards) {
    45	    if (forbidden.includes(card)) throw new IllegalCommandError('cannot discard the card being paid for')
    46	    if (!ps.hand.includes(card)) throw new IllegalCommandError(`${card} is not in your hand`)
    47	    if (seen.has(card)) throw new IllegalCommandError(`card ${card} discarded twice`)
    48	    seen.add(card)
    49	    const def = defOf(state, card)
    50	    if (def.elements.includes('light') || def.elements.includes('dark')) throw new IllegalCommandError('Light/Dark cards cannot be discarded for CP (§11.2.1.1)')
    51	    if (!def.elements.includes(element)) throw new IllegalCommandError(`${card} cannot produce ${element} CP`)
    52	    cp.push({ element, source: card }, { element, source: card })
    53	  }
    54	  return cp
    55	}
    56	
    57	/** §11.2.2.2–3: total ≥ cost, ≥1 CP of each of the card's elements; cost 0 → no CP may be generated (§11.2.2.4). */
    58	export function canPay(cost: number, elements: readonly Element[], cp: GeneratedCp[]): boolean {
    59	  if (cost === 0) return cp.length === 0   // §11.2.2.4 / §11.2.2.1 last sentence
    60	  if (cp.length < cost) return false
    61	  // `elements` is expected to already be `requiredElements(def)` (Light/Dark exemption applied by the caller).
    62	  return elements.every((e) => cp.some((c) => c.element === e))   // §11.2.2.1–2
    63	}
    64	
    65	/**
    66	 * What a payment has to cover, decoupled from any card's printed cost (spec C3-4).
    67	 *
    68	 * Casting derives this from the card definition, but an ability's cost is not the card's cost: Red Mage's
    69	 * ability costs `[Lightning]` — one CP, Lightning — on a card whose printed cost is 2, and Miner's costs a
    70	 * generic `[2]` on a card whose printed cost is 3. Deriving one from the other works only by coincidence.
    71	 */
    72	export interface CpRequirement {
    73	  readonly amount: number
    74	  readonly requiredElements: readonly Element[]
    75	  /** Cards that may not be a source. See `generateCp`. */
    76	  readonly excluded: readonly CardId[]
    77	}
    78	
    79	/** The requirement for CASTING `card` — the Light/Dark exemption applied (§11.2.1.1). */
    80	export function castRequirement(state: GameState, card: CardId): CpRequirement {
    81	  const def = defOf(state, card)
    82	  return { amount: def.cost, requiredElements: requiredElements(def), excluded: [card] }
    83	}
    84	
    85	/** Every *minimal* legal payment for `card` (no source can be removed and still pay). Used by legalCommands as the canonical choice list; `apply` accepts any payment that `canPay` — overpaying is legal (§11.2.2.3). */
    86	export function enumeratePayments(state: GameState, player: PlayerId, card: CardId): Payment[] {
    87	  return enumeratePaymentsFor(state, player, castRequirement(state, card))
    88	}
    89	
    90	/** As `enumeratePayments`, for any requirement — an ability cost as readily as a card's printed cost. */
    91	export function enumeratePaymentsFor(state: GameState, player: PlayerId, req: CpRequirement): Payment[] {
    92	  const card = req.excluded
    93	  if (req.amount === 0) return [{ dullBackups: [], discards: [] }]
    94	  const elements = req.requiredElements
    95	  const ps = state.players[player]
    96	  const backups = ps.backups.filter((b) => b.status === 'active' && !card.includes(b.id)).map((b) => b.id)
    97	  const discardOptions = ps.hand
    98	    .filter((id) => !card.includes(id))
    99	    .flatMap((id) => defOf(state, id).elements.filter((e) => e !== 'light' && e !== 'dark').map((element) => ({ card: id, element })))
   100	  // Each hand card may be discarded at most once, so choose ≤1 element option per card.
   101	  const byCard = new Map<CardId, Element[]>()
   102	  for (const o of discardOptions) byCard.set(o.card, [...(byCard.get(o.card) ?? []), o.element])
   103	  const handCards = [...byCard.keys()]
   104	
   105	  const results: Payment[] = []
   106	  const nBackupSubsets = 1 << backups.length
   107	  const choices = handCards.map((c) => byCard.get(c) as Element[])
   108	  // iterate over backup subsets × per-card choice (none | element_i)
   109	  const walk = (i: number, discards: Payment['discards'], backupMask: number) => {
   110	    if (i === handCards.length) {
   111	      const dullBackups = backups.filter((_, k) => backupMask & (1 << k))
   112	      const payment = { dullBackups, discards }
   113	      const cp = generateCp(state, player, payment, card)
   114	      if (!canPay(req.amount, elements, cp)) return
   115	      // minimality: removing any single source must break payment
   116	      for (let k = 0; k < dullBackups.length; k++) {
   117	        const less = { ...payment, dullBackups: dullBackups.filter((_, j) => j !== k) }
   118	        if (canPay(req.amount, elements, generateCp(state, player, less, card))) return
   119	      }
   120	      for (let k = 0; k < discards.length; k++) {
   121	        const less = { ...payment, discards: discards.filter((_, j) => j !== k) }
   122	        if (canPay(req.amount, elements, generateCp(state, player, less, card))) return
   123	      }
   124	      results.push(payment)
   125	      return
   126	    }
   127	    walk(i + 1, discards, backupMask)
   128	    for (const element of choices[i] as Element[]) walk(i + 1, [...discards, { card: handCards[i] as CardId, element }], backupMask)
   129	  }
   130	  for (let mask = 0; mask < nBackupSubsets; mask++) walk(0, [], mask)
   131	  return results
   132	}
   133	
   134	/** Execute a payment. INTERNAL — callers must have run generateCp + canPay first (cast.ts does). */
   135	export function pay(state: GameState, player: PlayerId, payment: Payment): [GameState, Event[]] {
   136	  const events: Event[] = []
   137	  const s = updatePlayer(state, player, (ps) => ({
   138	    ...ps,
   139	    backups: ps.backups.map((b) => (payment.dullBackups.includes(b.id) ? { ...b, status: 'dull' } : b)),
   140	    hand: ps.hand.filter((id) => !payment.discards.some((d) => d.card === id)),
   141	    breakZone: [...ps.breakZone, ...payment.discards.map((d) => d.card)],
   142	  }))
   143	  for (const d of payment.discards) events.push({ type: 'discarded', player, card: d.card, reason: 'cp' })
   144	  const cp = [...payment.dullBackups.map((id) => defOf(state, id).elements[0] as Element), ...payment.discards.flatMap((d) => [d.element, d.element])]
   145	  events.unshift({ type: 'cpGenerated', player, cp })
   146	  return [s, events]
   147	}
     1	import type { PlayerId, Element } from './types.js'
     2	import type { CardId } from './state.js'
     3	
     4	export interface Payment { dullBackups: CardId[]; discards: { card: CardId; element: Element }[] }
     5	export type Command =
     6	  | { type: 'chooseFirst'; player: PlayerId; goFirst: boolean }
     7	  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
     8	  | { type: 'castCharacter'; player: PlayerId; card: CardId; payment: Payment }
     9	  | { type: 'castSummon'; player: PlayerId; card: CardId; payment: Payment }
    10	  | { type: 'declareAttack'; player: PlayerId; attackers: CardId[] }
    11	  | { type: 'declareBlock'; player: PlayerId; blocker: CardId | null }
    12	  | { type: 'assignPartyDamage'; player: PlayerId; assignments: { target: CardId; amount: number }[] }
    13	  | { type: 'discardToHandSize'; player: PlayerId; cards: CardId[] }
    14	  /** Answers a `chooseTargets` pending (spec C1-6). `apply` re-validates uniqueness, min/max and membership. */
    15	  | { type: 'chooseTargets'; player: PlayerId; targets: readonly CardId[] }
    16	  /** Answers a `chooseMode` pending: indices into the pending's `labels`. Chosen modes run in listed order. */
    17	  | { type: 'chooseMode'; player: PlayerId; modes: readonly number[] }
    18	  /**
    19	   * Use an activated ability (spec C3-1).
    20	   *
    21	   * Targets are NOT carried here. Activating PREFLIGHTS them instead: the ability's target set is computed
    22	   * against the state as it will be once the costs are paid, and the activation is illegal unless a legal
    23	   * target exists (§11.6.5). Otherwise a player could pay a cost — usually putting the source card itself
    24	   * into the Break Zone — for an ability that then finds nothing to target and resolves as a no-op.
    25	   *
    26	   * Preflighting POST-cost is what makes this exact, and two things fall out of it for free: Undead Princess
    27	   * has already left the field by then and so cannot be her own target, and the candidate set the player is
    28	   * subsequently offered is precisely the one that was preflighted. Choosing stays a separate `Pending`,
    29	   * exactly as it already is for every targeted triggered ability.
    30	   *
    31	   * `abilityId` is the clause's stable id, never an index into the card's ability array: a card's implemented
    32	   * clauses arrive across different rungs, so indices shift under it.
    33	   */
    34	  | { type: 'activateAbility'; player: PlayerId; source: CardId; abilityId: string; payment: Payment }
    35	  | { type: 'pass'; player: PlayerId }
    36	  | { type: 'concede'; player: PlayerId }
     1	import type { PlayerId } from './types.js'
     2	import type { GameState } from './state.js'
     3	import { defOf } from './state.js'
     4	import type { Command } from './commands.js'
     5	import { enumeratePayments, enumeratePaymentsFor } from './cp.js'
     6	import { abilityCpRequirement, activationCheck } from './activate.js'
     7	import { castCheck } from './cast.js'
     8	import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'
     9	
    10	export function actingPlayer(state: GameState): PlayerId | null {
    11	  if (state.result) return null
    12	  return state.pending?.player ?? state.priority
    13	}
    14	
    15	function combinations<T>(items: T[], k: number): T[][] {
    16	  if (k === 0) return [[]]
    17	  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
    18	}
    19	
    20	export function legalCommands(state: GameState, player: PlayerId): Command[] {
    21	  if (state.result) return []
    22	  const out: Command[] = [{ type: 'concede', player }]   // §2.1: always allowed
    23	  if (actingPlayer(state) !== player) return out
    24	  const pending = state.pending
    25	  if (pending) {
    26	    switch (pending.kind) {
    27	      case 'chooseFirst':
    28	        out.push({ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }); break
    29	      case 'mulligan':
    30	        out.push({ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }); break
    31	      case 'discardToHandSize':
    32	        for (const cards of combinations(state.players[player].hand, pending.count)) out.push({ type: 'discardToHandSize', player, cards })
    33	        break
    34	      case 'declareBlock':
    35	        out.push({ type: 'declareBlock', player, blocker: null })
    36	        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
    37	        break
    38	      case 'assignPartyDamage':
    39	        for (const assignments of legalPartyDamageAssignments(state)) out.push({ type: 'assignPartyDamage', player, assignments })
    40	        break
    41	      case 'chooseTargets':
    42	        // Σ C(N, k) for k in min..max. `max` is the printed "up to N" (≤ 2 everywhere in the C1 pool) and N is
    43	        // one zone of one or both fields, so the bound is ~C(20,2) = 190 commands. A clause printing "up to 4"
    44	        // over a large Break Zone would need a candidate cap here — spec C1-6 flagged the combinatorics.
    45	        for (let k = pending.min; k <= pending.max; k++) {
    46	          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
    47	        }
    48	        break
    49	      case 'chooseMode':
    50	        // Σ C(modes, k). `modes` is a printed list of 2–3, so this is a handful of commands.
    51	        for (let k = pending.min; k <= pending.max; k++) {
    52	          for (const modes of combinations(pending.labels.map((_, i) => i), k)) out.push({ type: 'chooseMode', player, modes })
    53	        }
    54	        break
    55	    }
    56	    return out
    57	  }
    58	  switch (state.phase) {
    59	    case 'main1':
    60	    case 'main2': {
    61	      for (const card of state.players[player].hand) {
    62	        if (castCheck(state, player, card) !== null) continue
    63	        const type = defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter'
    64	        for (const payment of enumeratePayments(state, player, card)) out.push({ type, player, card, payment })
    65	      }
    66	      for (const c of activationsFor(state, player)) out.push(c)
    67	      out.push({ type: 'pass', player })
    68	      break
    69	    }
    70	    case 'attack': {
    71	      if (state.attack?.step === 'declaration') {
    72	        for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
    73	        out.push({ type: 'pass', player })
    74	      }
    75	      break
    76	    }
    77	    default:
    78	      break   // setup/active/draw/end never wait for a non-pending command
    79	  }
    80	  return out
    81	}
    82	
    83	/**
    84	 * Every legal activation for `player`, one per (source card, clause, minimal payment).
    85	 *
    86	 * Scans the three zones an activated ability can live in rather than just the field: `sourceZone` is a
    87	 * declared precondition on the ability (spec C3-3), so Geomancer's hand-only ability and a future Break-Zone
    88	 * ability enumerate through this same path instead of needing their own.
    89	 */
    90	function activationsFor(state: GameState, player: PlayerId): Command[] {
    91	  const out: Command[] = []
    92	  const ps = state.players[player]
    93	  const sources = [...ps.hand, ...ps.breakZone, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id)]
    94	  for (const source of sources) {
    95	    for (const ability of defOf(state, source).abilities ?? []) {
    96	      if (ability.trigger.kind !== 'activated') continue
    97	      if (activationCheck(state, player, source, ability.id) !== null) continue
    98	      const req = abilityCpRequirement(source, ability.trigger.cost)
    99	      for (const payment of enumeratePaymentsFor(state, player, req)) {
   100	        out.push({ type: 'activateAbility', player, source, abilityId: ability.id, payment })
   101	      }
   102	    }
   103	  }
   104	  return out
   105	}
     1	import { opponentOf } from './types.js'
     2	import type { GameState } from './state.js'
     3	import { EMPTY_RESOLUTION, hasResolutionWork } from './abilities.js'
     4	import type { Command } from './commands.js'
     5	import type { Event } from './events.js'
     6	import { IllegalCommandError } from './errors.js'
     7	import { applyActivateAbility } from './activate.js'
     8	import { actingPlayer } from './legal.js'
     9	import { applyChooseFirst, applyMulligan } from './setup.js'
    10	import { applyDiscardToHandSize, applyPass } from './phases.js'
    11	import { applyCastCharacter, applyCastSummon } from './cast.js'
    12	import { applyAssignPartyDamage, applyDeclareAttack, applyDeclareBlock } from './attack.js'
    13	import { runRuleProcesses } from './rules.js'
    14	import { applyChooseMode, applyChooseTargets, drainResolution } from './resolve.js'
    15	
    16	export interface ApplyResult { state: GameState; events: Event[] }
    17	
    18	/**
    19	 * §12.3 rule processes and the ability agenda settle together: a rule process can enqueue a zone-change trigger
    20	 * (spec C1-8) and a resolving ability can create work for a rule process (damage, a power debuff), so alternate
    21	 * until both are quiet — or until an ability owes the player a choice, which ends the command.
    22	 *
    23	 * `resolution.steps` is only reset once the whole settlement is idle. Resetting it per drain would let a
    24	 * rule-process ⇄ trigger cycle restart the counter every pass and never hit the cap (spec C1-5).
    25	 */
    26	function settle(state: GameState): [GameState, Event[]] {
    27	  const events: Event[] = []
    28	  let s = state
    29	  // Rule processes belong BETWEEN frames, never inside one — `resolution.active` is exactly the flag for
    30	  // "a frame is mid-flight", so the loop runs them only when it is null. Three failures this ordering avoids,
    31	  // each of which the other two orderings caused:
    32	  //
    33	  //  - Run them only at the top and exit straight after a drain, and a Forward killed by ability damage is
    34	  //    never broken (§12.4.5): Ramuh dealing 5000 to a 5000-power Forward left it standing.
    35	  //  - Run them on EVERY pass, and they fire between a choice being raised and answered, breaking a card that
    36	  //    is already in `pending.candidates` so the answer is rejected as an illegal target.
    37	  //  - Run them before RESUMING a frame, and they break a card the frame already chose: Ramuh may legally
    38	  //    pick damage and Haste for the same Forward, and the Haste would silently skip a target the damage had
    39	  //    just killed. A frame must be atomic across the commands that answer its prompts.
    40	  //
    41	  // Spec C2-6 REFINES that without disturbing any of the three: `drainResolution` now completes ONE frame and
    42	  // returns, so this loop gets a rule-process pass BETWEEN frames as well as before the first one. `active` is
    43	  // still the guard, so a suspended frame is still never interrupted — the fourth wrong ordering would be to
    44	  // resolve Luso's "break it" before §12.4.5 had broken the Forward Luso's own damage killed.
    45	  for (;;) {
    46	    if (!s.resolution.active) {
    47	      const [ruled, ruleEvents] = runRuleProcesses(s)
    48	      s = ruled; events.push(...ruleEvents)
    49	      if (s.result) break
    50	      if (!hasResolutionWork(s.resolution)) break   // settled, and rule processes have run
    51	    }
    52	    const [drained, drainEvents] = drainResolution(s)
    53	    s = drained; events.push(...drainEvents)
    54	    if (s.result || s.pending) break
    55	  }
    56	  if (s.result) s = { ...s, resolution: EMPTY_RESOLUTION }   // nothing may stay queued after game over
    57	  else if (!s.pending && !hasResolutionWork(s.resolution)) s = { ...s, resolution: { ...s.resolution, steps: 0 } }
    58	  return [s, events]
    59	}
    60	
    61	export function apply(state: GameState, command: Command): ApplyResult {
    62	  if (state.result) throw new IllegalCommandError('game is over', command)
    63	  if (command.type !== 'concede' && actingPlayer(state) !== command.player) throw new IllegalCommandError(`player ${command.player} is not the acting player`, command)
    64	
    65	  let s: GameState; let events: Event[]
    66	  try {
    67	    switch (command.type) {
    68	      case 'chooseFirst': [s, events] = applyChooseFirst(state, command.player, command.goFirst); break
    69	      case 'mulligan': [s, events] = applyMulligan(state, command.player, command.redraw); break
    70	      case 'castCharacter': [s, events] = applyCastCharacter(state, command.player, command.card, command.payment); break
    71	      case 'castSummon': [s, events] = applyCastSummon(state, command.player, command.card, command.payment); break
    72	      case 'declareAttack': [s, events] = applyDeclareAttack(state, command.player, command.attackers); break
    73	      case 'declareBlock': [s, events] = applyDeclareBlock(state, command.player, command.blocker); break
    74	      case 'assignPartyDamage': [s, events] = applyAssignPartyDamage(state, command.player, command.assignments); break
    75	      case 'discardToHandSize': [s, events] = applyDiscardToHandSize(state, command.player, command.cards); break
    76	      case 'chooseTargets': [s, events] = applyChooseTargets(state, command.player, command.targets); break
    77	      case 'chooseMode': [s, events] = applyChooseMode(state, command.player, command.modes); break
    78	      case 'activateAbility':
    79	        [s, events] = applyActivateAbility(state, command.player, command.source, command.abilityId, command.payment); break
    80	      case 'pass': [s, events] = applyPass(state, command.player); break
    81	      case 'concede':
    82	        s = { ...state, pending: null, resolution: EMPTY_RESOLUTION, result: { winner: opponentOf(command.player), reason: `player ${command.player} conceded (§2.1)` } }; events = []; break
    83	    }
    84	  } catch (e) {
    85	    if (e instanceof IllegalCommandError) throw new IllegalCommandError(e.message, command)
    86	    throw e
    87	  }
    88	  if (!s.result) { const [t, more] = settle(s); s = t; events = [...events, ...more] }
    89	  if (s.result && events.at(-1)?.type !== 'gameOver') events = [...events, { type: 'gameOver', result: s.result }]
    90	  return { state: s, events }
    91	}
     1	import type { PlayerId } from './types.js'
     2	import { opponentOf } from './types.js'
     3	import { EMPTY_RESOLUTION } from './abilities.js'
     4	import type { ZoneTransitionReason } from './abilities.js'
     5	import type { CardId, FieldCard, GameState } from './state.js'
     6	import { DAMAGE_TO_LOSE, defOf, powerOf, updatePlayer } from './state.js'
     7	import type { Event } from './events.js'
     8	import type { DamageOccurrence } from './resolve.js'
     9	import { enqueueDamageTriggers, enqueueZoneChangeTriggers } from './resolve.js'
    10	
    11	/**
    12	 * §10.1.4.1. `sources` is EVERY card dealing this one point of damage — for an unblocked party, all of it, because
    13	 * attribution is by party MEMBERSHIP and never by array position (spec C2-8): `at.attackers` is sorted by card id,
    14	 * so singling out one member would make a Luso trigger or not depending on where its id happened to sort. The
    15	 * occurrences share the single point of damage, they do not multiply it. `null` means nothing is attributable.
    16	 */
    17	export function dealPlayerDamage(state: GameState, victim: PlayerId, sources: readonly DamageOccurrence[] | null): [GameState, Event[]] {
    18	  const ps = state.players[victim]
    19	  const top = ps.deck[0]
    20	  if (top === undefined) {
    21	    return [{ ...state, result: { winner: opponentOf(victim), reason: `player ${victim} took damage with an empty deck (§3.1.3)` } }, []]
    22	  }
    23	  let s = updatePlayer(state, victim, (q) => ({ ...q, deck: q.deck.slice(1), damageZone: [...q.damageZone, top] }))
    24	  const events: Event[] = [{ type: 'playerDamaged', player: victim, card: top }]
    25	  if (defOf(s, top).exBurst) events.push({ type: 'exBurstSkipped', player: victim, card: top })   // MVP0-SIMPLIFICATION: §11.10 EX Burst not resolved
    26	  // Dispatched only once the damage has LANDED: the empty-deck branch above ends the game instead (§3.1.3), and
    27	  // `checkInvariants` forbids anything staying queued after game over.
    28	  if (sources) s = enqueueDamageTriggers(s, sources)
    29	  return [s, events]
    30	}
    31	
    32	/**
    33	 * A card leaving a zone, recorded with a PRE-transition snapshot (spec C1-8). Rule processing removes every
    34	 * affected Forward simultaneously and only then emits events; scanning the resulting field would lose the
    35	 * trigger of a card that died at the same instant, so triggers must be discovered from these records instead.
    36	 * `cause`/`causeController` is what C2 needs for Cloud's "cannot be returned by your OPPONENT's abilities".
    37	 */
    38	export interface ZoneTransition {
    39	  readonly card: CardId
    40	  /**
    41	   * The player whose field the card was on — the CONTROLLER. C1 called this field `owner`, which it never was:
    42	   * "a Forward OPPONENT CONTROLS" is a statement about the field array the card sat in (spec C2-2).
    43	   */
    44	  readonly controller: PlayerId
    45	  /** Real ownership, `CardInstance.owner` (§7.10) — where the card belongs, not who was playing it. */
    46	  readonly owner: PlayerId
    47	  readonly from: 'forwards' | 'backups'
    48	  readonly to: 'breakZone'
    49	  /**
    50	   * `ability` is a direct `breakCard`; `zeroPower`/`damage` are the §12.4.4/§12.4.5 rule processes; `cost` is
    51	   * a card put into the Break Zone to PAY for its own activated ability (spec C3-7).
    52	   *
    53	   * `cost` is not a break (§15.1.1.3.2): `cannotBeBroken` does not prevent it and no `broken` event is
    54	   * emitted. It is still a zone MOVEMENT, so observers of "put from the field into the Break Zone" — which is
    55	   * the printed wording the implemented watcher encodes — must see it. Anything that means "was broken"
    56	   * specifically must filter on this field rather than assume every transition is a break.
    57	   */
    58	  readonly reason: ZoneTransitionReason
    59	  /** The card whose ability caused the transition; null for a rule process, which has no source. */
    60	  readonly cause: CardId | null
    61	  readonly causeController: PlayerId | null
    62	  readonly snapshot: FieldCard
    63	}
    64	
    65	/**
    66	 * The Forwards §12.4.4/§12.4.5 would remove RIGHT NOW, snapshotted before anything moves.
    67	 * `cannotBeBroken` (spec C1-7) blocks the §12.4.5 damage break but NOT the §12.4.4 zero-power process.
    68	 */
    69	export function pendingBreakTransitions(state: GameState): ZoneTransition[] {
    70	  const out: ZoneTransition[] = []
    71	  for (const p of [0, 1] as const) {
    72	    for (const c of state.players[p].forwards) {
    73	      const owner = state.cards[c.id]?.owner ?? p
    74	      const base = { card: c.id, controller: p, owner, from: 'forwards', to: 'breakZone', cause: null, causeController: null, snapshot: c } as const
    75	      const power = powerOf(state, c)
    76	      if (power <= 0) out.push({ ...base, reason: 'zeroPower' })
    77	      else if (power >= 1000 && c.damage >= power && !c.flags.includes('cannotBeBroken')) out.push({ ...base, reason: 'damage' })
    78	    }
    79	  }
    80	  return out
    81	}
    82	
    83	
    84	/**
    85	 * §12.4.1 ends the game, and nothing resolves afterwards. `apply` skips `settle` entirely once `result` is set, so
    86	 * whatever a rule process queued on its way here — the seventh point of player damage triggers its dealer's
    87	 * `dealtDamage` clause like any other (spec C2-8) — would otherwise outlive game over and trip `checkInvariants`.
    88	 */
    89	function stopped(state: GameState): GameState {
    90	  return state.result ? { ...state, resolution: EMPTY_RESOLUTION } : state
    91	}
    92	
    93	export function runRuleProcesses(state: GameState): [GameState, Event[]] {
    94	  const events: Event[] = []
    95	  let s = state
    96	  if (s.result) return [stopped(s), events]
    97	  // §12.4.4 (zero power → break zone) and §12.4.5 (power ≥ 1000, damage ≥ power → broken), simultaneously, then re-check
    98	  for (;;) {
    99	    const transitions = pendingBreakTransitions(s)
   100	    if (!transitions.length) break
   101	    const pre = s   // watchers must be read while `s` still holds every pre-removal field card (spec C2-4)
   102	    const leaving = transitions.map((t) => t.card)
   103	    // §12.4.4/§15.1.1.3: a broken card goes to its OWNER's Break Zone, which is not the same player as the
   104	    // controller whose field it was removed from. Owner and controller coincide for the whole MVP0 pool (nothing
   105	    // changes control yet), so this is unobservable today — but the transitions already carry both, and taking
   106	    // the controller here was the bug that made "capture owner properly" only half-done.
   107	    for (const p of [0, 1] as const) {
   108	      s = updatePlayer(s, p, (ps) => ({ ...ps, forwards: ps.forwards.filter((c) => !leaving.includes(c.id)) }))
   109	    }
   110	    for (const t of transitions) {
   111	      s = updatePlayer(s, t.owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, t.card] }))
   112	    }
   113	    for (const t of transitions) {
   114	      if (t.reason === 'zeroPower') events.push({ type: 'putIntoBreakZone', card: t.card, reason: 'zeroPower' })
   115	    }
   116	    for (const t of transitions) {
   117	      if (t.reason === 'damage') events.push({ type: 'broken', card: t.card })
   118	    }
   119	    s = enqueueZoneChangeTriggers(pre, s, transitions)
   120	  }
   121	  // §12.4.1 seven damage; §3.3 simultaneous → draw
   122	  const dead = ([0, 1] as const).filter((p) => s.players[p].damageZone.length >= DAMAGE_TO_LOSE)
   123	  if (dead.length === 2) s = { ...s, result: { winner: null, reason: 'both players reached 7 damage (§3.3)' } }
   124	  else if (dead.length === 1) s = { ...s, result: { winner: opponentOf(dead[0] as PlayerId), reason: `player ${dead[0]} has 7 damage (§12.4.1)` } }
   125	  return [stopped(s), events]
   126	}
     1	import type { PlayerId } from './types.js'
     2	import { opponentOf } from './types.js'
     3	import type { GameState } from './state.js'
     4	import { updatePlayer } from './state.js'
     5	import type { Event } from './events.js'
     6	
     7	/**
     8	 * Drawing, in a module that depends on nothing but state (spec C3-9).
     9	 *
    10	 * This used to live in `phases.ts`, which is unreachable from `resolve.ts`: `phases.ts` imports
    11	 * `enterAttackDeclaration` from `resolve.ts`, so importing back would be a cycle. Miner's "Draw 1 card" is an
    12	 * ability effect and therefore resolves inside `resolve.ts`, which is what forced the extraction. Both
    13	 * callers share this one implementation so the §3.1.2 empty-deck rule cannot drift between them.
    14	 */
    15	export function drawCards(state: GameState, p: PlayerId, n: number): [GameState, Event[]] {
    16	  const ps = state.players[p]
    17	  if (ps.deck.length < n) {
    18	    // §3.1.2 — attempting to draw from an empty deck loses; the cards that COULD be drawn are still drawn.
    19	    const s = updatePlayer(state, p, (q) => ({ ...q, deck: [], hand: [...q.hand, ...q.deck] }))
    20	    return [
    21	      { ...s, result: { winner: opponentOf(p), reason: `player ${p} could not draw a card (§3.1.2)` } },
    22	      [{ type: 'drew', player: p, count: ps.deck.length }],
    23	    ]
    24	  }
    25	  const s = updatePlayer(state, p, (q) => ({ ...q, deck: q.deck.slice(n), hand: [...q.hand, ...q.deck.slice(0, n)] }))
    26	  return [s, [{ type: 'drew', player: p, count: n }]]
    27	}

exec
/bin/zsh -lc 'nl -ba packages/engine/src/abilities.ts && nl -ba packages/engine/src/commands.ts && nl -ba packages/engine/src/legal.ts && nl -ba packages/engine/src/events.ts && nl -ba packages/engine/src/cast.ts && nl -ba packages/engine/src/phases.ts' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { CardType, Element, Keyword, PlayerId } from './types.js'
     2	import type { CardId } from './state.js'
     3	
     4	/**
     5	 * The ability AST (spec C1-1/C1-2). Abilities are DATA, hand-written per clause and hung off `CardDef`,
     6	 * never parsed from `def.text` at runtime and never functions.
     7	 *
     8	 * Everything in this file must stay plain records/arrays/strings/numbers/booleans, readonly, with no
     9	 * `Map`/`Set`/closures, because:
    10	 *   - `viewFor` and `determinise` both end in `structuredClone`, which strips functions outright;
    11	 *   - `determinise` rebuilds a GameState from a PlayerView whose only card-definition channel is
    12	 *     `view.defs` — so hanging the AST on `CardDef` is what makes the AI simulate the SAME game it
    13	 *     plays. An injected function registry silently gives the AI a vanilla game (spec C1-2);
    14	 *   - self-play's strict mode detects mutation with `JSON.stringify`, and `session.ts` serialises
    15	 *     `CreateGameOptions`.
    16	 */
    17	
    18	/** Which pile a target is drawn from. */
    19	export type TargetZone = 'forwards' | 'backups' | 'breakZone'
    20	
    21	/** Whose cards are eligible. `any` means either player's. */
    22	export type TargetController = 'self' | 'opponent' | 'any'
    23	
    24	export interface TargetFilter {
    25	  readonly type?: CardType
    26	  /**
    27	   * Any of these types. "Character" is Forward, Backup OR Monster — never Summon — and a single `type`
    28	   * cannot say that, which both Prishe's and Luso's Break-Zone retrieval need (spec C2-9).
    29	   */
    30	  readonly types?: readonly CardType[]
    31	  readonly element?: Element
    32	  /** Inclusive printed-cost ceiling, e.g. Lightning's "cost 4 or less" (C2). */
    33	  readonly maxCost?: number
    34	  /** "other than <this card>" — excludes the ability's own source. */
    35	  readonly excludeSource?: boolean
    36	  /** "other than Card Name <X>" — excludes every card sharing the source's name (Billy Bob). */
    37	  readonly excludeSourceName?: boolean
    38	}
    39	
    40	export interface TargetSpec {
    41	  readonly zone: TargetZone
    42	  readonly controller: TargetController
    43	  readonly filter?: TargetFilter
    44	}
    45	
    46	/**
    47	 * One step of an ability. Effects are executed in order by the resolution agenda; the ones that need a
    48	 * player decision suspend the frame and raise a `Pending` (spec C1-3/C1-6).
    49	 *
    50	 * `chooseTargets` and `chooseModes` are the only effects that can suspend. `then`/`effects` nest, which
    51	 * is what lets Shantotto raise a mode choice whose chosen branch then raises a target choice.
    52	 */
    53	export type Effect =
    54	  /** Choose `min..max` targets, then run `then` once with `chosen` bound to them. min 0 = "up to". */
    55	  | { readonly kind: 'chooseTargets'; readonly min: number; readonly max: number; readonly from: TargetSpec; readonly then: readonly Effect[] }
    56	  /** Choose `min..max` of `modes` ("select up to 2 of the 3 following"); chosen modes run in listed order. */
    57	  | { readonly kind: 'chooseModes'; readonly min: number; readonly max: number; readonly modes: readonly AbilityMode[] }
    58	  /** Run `do` once per card matching `from`, with `chosen` bound to that one card. Untargeted — no choice. */
    59	  | { readonly kind: 'forEach'; readonly from: TargetSpec; readonly do: readonly Effect[] }
    60	  | { readonly kind: 'dull' }
    61	  | { readonly kind: 'damage'; readonly amount: number }
    62	  | { readonly kind: 'breakCard' }
    63	  | { readonly kind: 'addPower'; readonly amount: number }
    64	  | { readonly kind: 'grantKeyword'; readonly keyword: Keyword }
    65	  | { readonly kind: 'grantFlag'; readonly flag: FieldFlag }
    66	  | { readonly kind: 'moveToHand' }
    67	  /**
    68	   * Draw `count` cards for the resolving ability's controller. The primitive itself lives in `draw.ts` rather
    69	   * than `phases.ts`, because `phases.ts` imports `resolve.ts` and so cannot be imported back (spec C3-9).
    70	   */
    71	  | { readonly kind: 'draw'; readonly count: number }
    72	  /**
    73	   * Act on the card the TRIGGER EVENT is about — Luso's "break **it**" (spec C2-5). Binds `chosen` to the
    74	   * event's subject and runs `do`, so every existing effect works on it unchanged. Deliberately NOT a target
    75	   * choice: "it" is named by the printed text, and offering it as a choice would let the player retarget a
    76	   * printed effect. A no-op when the frame has no trigger event, or the subject is not a card.
    77	   */
    78	  | { readonly kind: 'onSubject'; readonly do: readonly Effect[] }
    79	
    80	/** Until-end-of-turn protection that `granted: Keyword[]` cannot express (spec C1-7). */
    81	export const FIELD_FLAGS = ['cannotBeBroken'] as const
    82	export type FieldFlag = (typeof FIELD_FLAGS)[number]
    83	
    84	export interface AbilityMode {
    85	  /** Stable identifier, and the text the UI shows on the button. Quote the printed wording. */
    86	  readonly label: string
    87	  readonly effects: readonly Effect[]
    88	}
    89	
    90	/** Which side of the watcher a moved/damaged card must be on, relative to the WATCHER's controller. */
    91	export type TriggerWhose = 'self' | 'opponent' | 'any'
    92	
    93	/**
    94	 * When a clause fires. The first two are "this card just did something" and are all C1 needed. The last two
    95	 * are C2's observer triggers: something happened, and this card was watching — which is why they carry a
    96	 * predicate rather than being bare strings.
    97	 *
    98	 * `enterField` covers casting AND being put onto the field by another ability (C3's Hugh Yurg), which is
    99	 * why it is not keyed off the `cast` event.
   100	 */
   101	export type AbilityTrigger =
   102	  | { readonly kind: 'enterField' }
   103	  | { readonly kind: 'summonResolve' }
   104	  /**
   105	   * THIS card dealt damage — combat or ability alike (spec C2-7). `whose` is the DAMAGED side relative to
   106	   * this card's controller: Luso and Prishe both print "deals damage to **your opponent**", and without it the
   107	   * restriction lives nowhere in code and any future self-damage or redirect path fires them wrongly.
   108	   */
   109	  | { readonly kind: 'dealtDamage'; readonly to: 'forward' | 'player'; readonly whose: TriggerWhose }
   110	  /**
   111	   * Some OTHER card moved, and this one was watching (spec C2-3/C2-4). `of` is the moved card's TYPE:
   112	   * Lightning watches "a **Forward** … put from the field into the Break Zone", and leaving that restriction
   113	   * implicit in "the only producer happens to scan the forwards array" makes it fire on the first Backup a
   114	   * later rung breaks.
   115	   */
   116	  | { readonly kind: 'observesZoneChange'; readonly from: 'field'; readonly to: 'breakZone'; readonly whose: TriggerWhose; readonly of: CardType }
   117	  /**
   118	   * NOT a trigger at all: an ability the player chooses to use (spec C3-1). It lives in this union because
   119	   * every dispatch site already switches on `kind`, so an activated ability is inertly ignored by trigger
   120	   * dispatch — and the compiler finds any switch that forgot it.
   121	   *
   122	   * `sourceZone` is an activation PRECONDITION, not part of the cost (C3-3): Geomancer's ability is usable
   123	   * only from hand, and inferring that from "its cost discards itself" would need replacing the moment a
   124	   * Break-Zone ability arrives.
   125	   */
   126	  | { readonly kind: 'activated'; readonly sourceZone: ActivationSourceZone; readonly cost: AbilityCost }
   127	
   128	export type ActivationSourceZone = 'field' | 'hand' | 'breakZone'
   129	
   130	/** Mirrors `ZoneTransition.reason` (rules.ts); declared here so the trigger event can carry it without a cycle. */
   131	export type ZoneTransitionReason = 'zeroPower' | 'damage' | 'ability' | 'cost'
   132	
   133	/**
   134	 * What activating costs. Every part is paid at once or the activation is not legal at all (§11.6.10) — there
   135	 * is no partial payment and no "pay what you can".
   136	 */
   137	export interface AbilityCost {
   138	  /**
   139	   * CP. `amount` is the number required and `requiredElements` the Elements that must be among them, which
   140	   * is NOT derivable from the card's printed cost: Red Mage's ability costs `[Lightning]` (1, Lightning) on a
   141	   * printed-2 card, and Miner's costs `[2]` (2, generic) on a printed-3. `[0]` is `{ amount: 0 }` and admits
   142	   * only the empty payment.
   143	   */
   144	  readonly cp?: { readonly amount: number; readonly requiredElements?: readonly Element[] }
   145	  /**
   146	   * The dull icon. Gates active status and the entered-this-turn/Haste rule (§11.6.2.2) — and ONLY when
   147	   * present: Undead Princess's cost is a self-break with no dull icon, so she may activate while dulled and
   148	   * on the turn she enters.
   149	   */
   150	  readonly dull?: true
   151	  /**
   152	   * "Put <this card> into the Break Zone". NOT a break (§15.1.1.3.2): `cannotBeBroken` does not prevent it
   153	   * and it emits no `broken` event — but it IS a zone movement, so observers of "put from the field into the
   154	   * Break Zone" must still see it (spec C3-7).
   155	   */
   156	  readonly selfToBreakZone?: true
   157	  /** "discard <this card>", from hand. */
   158	  readonly selfDiscard?: true
   159	}
   160	
   161	/**
   162	 * What the trigger was about, carried on the frame so `onSubject` can act on it and the log can narrate it.
   163	 * Plain data: it rides on `GameState` through `structuredClone` like everything else.
   164	 */
   165	export type TriggerEvent =
   166	  | { readonly kind: 'damage'; readonly source: CardId; readonly sourceController: PlayerId; readonly target: CardId | null; readonly victim: PlayerId | null; readonly amount: number }
   167	  /**
   168	   * `reason` rides along so narration can tell the player what actually happened. Every transition into the
   169	   * Break Zone used to be described as "was broken", which stopped being true in C3: a card put there to PAY
   170	   * for its own ability was not broken (§15.1.1.3.2), and saying so would misreport the board.
   171	   */
   172	  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly from: 'field'; readonly to: 'breakZone'; readonly controller: PlayerId; readonly owner: PlayerId; readonly reason: ZoneTransitionReason }
   173	
   174	export interface Ability {
   175	  /**
   176	   * Stable per-clause id, `<card code>:<slug>` (e.g. `16-092C:etb`). Coverage is tracked per CLAUSE, not
   177	   * per card (spec C1-9): no card in this pool is wholly inside one rung, so a card keeps emitting
   178	   * `unimplementedAbility` for the clauses that are still unimplemented even after this one lands.
   179	   */
   180	  readonly id: string
   181	  readonly trigger: AbilityTrigger
   182	  /** The printed wording this AST encodes, quoted verbatim. Reviewers check the AST against THIS. */
   183	  readonly text: string
   184	  readonly effects: readonly Effect[]
   185	}
   186	
   187	// ---------------------------------------------------------------------------
   188	// Resolution agenda (spec C1-3)
   189	// ---------------------------------------------------------------------------
   190	
   191	/**
   192	 * A suspended ability in mid-execution. `path` is the program counter: an index per nesting level, so a
   193	 * frame can resume inside `then`/`modes`/`do` after a player answers. `chosen` is the target binding the
   194	 * innermost `chooseTargets`/`forEach` established.
   195	 */
   196	export interface Frame {
   197	  readonly abilityId: string
   198	  /** The card whose ability this is — resolves `excludeSource`, and it may already have left the field. */
   199	  readonly source: CardId
   200	  /** The player who controls the ability and therefore answers its choices. */
   201	  readonly controller: PlayerId
   202	  readonly path: readonly number[]
   203	  readonly chosen: readonly CardId[]
   204	  /**
   205	   * What fired this clause, for `onSubject` and for narration. Null for `enterField`/`summonResolve`, which
   206	   * are about the source itself. It must survive prompts and the source leaving the field (spec C2-5).
   207	   */
   208	  readonly triggerEvent: TriggerEvent | null
   209	  /** Modes picked by an enclosing `chooseModes`, as indices into its `modes`. */
   210	  readonly modes: readonly number[]
   211	}
   212	
   213	/**
   214	 * Work the engine owes itself. `pending` stays exactly what it always was — the ONE decision a player
   215	 * currently owes — and is cleared before the agenda resumes; this is the queue behind it.
   216	 */
   217	export interface Resolution {
   218	  /** The frame currently executing, if any. Corresponds 1:1 with a non-null ability `pending`. */
   219	  readonly active: Frame | null
   220	  /** Triggered clauses waiting their turn, in trigger order. */
   221	  readonly queue: readonly Frame[]
   222	  /**
   223	   * A system continuation to run once the queue drains — e.g. finishing a phase transition that a
   224	   * trigger interrupted. C1 has none; C2's Cloud Attack-Phase clause is the first.
   225	   */
   226	  readonly continuation: 'enterAttackDeclaration' | null
   227	  /**
   228	   * Total effect steps spent, across the WHOLE agenda and PERSISTING across player choices (spec C1-5).
   229	   * A call-depth cap would not catch a trigger cycle that launders itself through a `chooseTargets`
   230	   * prompt. Exceeding `MAX_RESOLUTION_STEPS` throws loudly rather than hanging the browser.
   231	   */
   232	  readonly steps: number
   233	}
   234	
   235	export const MAX_RESOLUTION_STEPS = 512
   236	
   237	export const EMPTY_RESOLUTION: Resolution = { active: null, queue: [], continuation: null, steps: 0 }
   238	
   239	/**
   240	 * Does the agenda still owe the engine anything? A `continuation` counts: it is work only `drainResolution`
   241	 * consumes, so settlement, `checkInvariants` and the AI's diagnostics that looked at `active`/`queue` alone
   242	 * would call a state with nothing but a continuation "settled" and strand it there permanently.
   243	 */
   244	export function hasResolutionWork(r: Resolution): boolean {
   245	  return r.active !== null || r.queue.length > 0 || r.continuation !== null
   246	}
   247	
   248	/**
   249	 * The printed cost, rendered the way the card prints it — `[Lightning][Dull]`, `[2][Dull], put into the Break
   250	 * Zone`. Lives here so the CLI and the browser cannot drift into describing the same ability differently.
   251	 */
   252	export function describeAbilityCost(cost: AbilityCost): string {
   253	  // Icons run together and prose is comma-separated, because that is how the cards print it:
   254	  // `[2][Dull], put Miner into the Break Zone` — never `[2], [Dull], put ...`.
   255	  let icons = ''
   256	  if (cost.cp) {
   257	    const els = cost.cp.requiredElements ?? []
   258	    // A required Element prints as its own icon; a generic cost prints as the number.
   259	    icons += els.length ? els.map((e) => `[${e[0]?.toUpperCase()}${e.slice(1)}]`).join('') : `[${cost.cp.amount}]`
   260	  }
   261	  if (cost.dull) icons += '[Dull]'
   262	  const prose: string[] = []
   263	  if (cost.selfToBreakZone) prose.push('put into the Break Zone')
   264	  if (cost.selfDiscard) prose.push('discard')
   265	  return [icons, ...prose].filter(Boolean).join(', ') || '[0]'
   266	}
     1	import type { PlayerId, Element } from './types.js'
     2	import type { CardId } from './state.js'
     3	
     4	export interface Payment { dullBackups: CardId[]; discards: { card: CardId; element: Element }[] }
     5	export type Command =
     6	  | { type: 'chooseFirst'; player: PlayerId; goFirst: boolean }
     7	  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
     8	  | { type: 'castCharacter'; player: PlayerId; card: CardId; payment: Payment }
     9	  | { type: 'castSummon'; player: PlayerId; card: CardId; payment: Payment }
    10	  | { type: 'declareAttack'; player: PlayerId; attackers: CardId[] }
    11	  | { type: 'declareBlock'; player: PlayerId; blocker: CardId | null }
    12	  | { type: 'assignPartyDamage'; player: PlayerId; assignments: { target: CardId; amount: number }[] }
    13	  | { type: 'discardToHandSize'; player: PlayerId; cards: CardId[] }
    14	  /** Answers a `chooseTargets` pending (spec C1-6). `apply` re-validates uniqueness, min/max and membership. */
    15	  | { type: 'chooseTargets'; player: PlayerId; targets: readonly CardId[] }
    16	  /** Answers a `chooseMode` pending: indices into the pending's `labels`. Chosen modes run in listed order. */
    17	  | { type: 'chooseMode'; player: PlayerId; modes: readonly number[] }
    18	  /**
    19	   * Use an activated ability (spec C3-1).
    20	   *
    21	   * Targets are NOT carried here. Activating PREFLIGHTS them instead: the ability's target set is computed
    22	   * against the state as it will be once the costs are paid, and the activation is illegal unless a legal
    23	   * target exists (§11.6.5). Otherwise a player could pay a cost — usually putting the source card itself
    24	   * into the Break Zone — for an ability that then finds nothing to target and resolves as a no-op.
    25	   *
    26	   * Preflighting POST-cost is what makes this exact, and two things fall out of it for free: Undead Princess
    27	   * has already left the field by then and so cannot be her own target, and the candidate set the player is
    28	   * subsequently offered is precisely the one that was preflighted. Choosing stays a separate `Pending`,
    29	   * exactly as it already is for every targeted triggered ability.
    30	   *
    31	   * `abilityId` is the clause's stable id, never an index into the card's ability array: a card's implemented
    32	   * clauses arrive across different rungs, so indices shift under it.
    33	   */
    34	  | { type: 'activateAbility'; player: PlayerId; source: CardId; abilityId: string; payment: Payment }
    35	  | { type: 'pass'; player: PlayerId }
    36	  | { type: 'concede'; player: PlayerId }
     1	import type { PlayerId } from './types.js'
     2	import type { GameState } from './state.js'
     3	import { defOf } from './state.js'
     4	import type { Command } from './commands.js'
     5	import { enumeratePayments, enumeratePaymentsFor } from './cp.js'
     6	import { abilityCpRequirement, activationCheck } from './activate.js'
     7	import { castCheck } from './cast.js'
     8	import { legalAttackSets, legalBlockers, legalPartyDamageAssignments } from './attack.js'
     9	
    10	export function actingPlayer(state: GameState): PlayerId | null {
    11	  if (state.result) return null
    12	  return state.pending?.player ?? state.priority
    13	}
    14	
    15	function combinations<T>(items: T[], k: number): T[][] {
    16	  if (k === 0) return [[]]
    17	  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
    18	}
    19	
    20	export function legalCommands(state: GameState, player: PlayerId): Command[] {
    21	  if (state.result) return []
    22	  const out: Command[] = [{ type: 'concede', player }]   // §2.1: always allowed
    23	  if (actingPlayer(state) !== player) return out
    24	  const pending = state.pending
    25	  if (pending) {
    26	    switch (pending.kind) {
    27	      case 'chooseFirst':
    28	        out.push({ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }); break
    29	      case 'mulligan':
    30	        out.push({ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }); break
    31	      case 'discardToHandSize':
    32	        for (const cards of combinations(state.players[player].hand, pending.count)) out.push({ type: 'discardToHandSize', player, cards })
    33	        break
    34	      case 'declareBlock':
    35	        out.push({ type: 'declareBlock', player, blocker: null })
    36	        for (const blocker of legalBlockers(state, player)) out.push({ type: 'declareBlock', player, blocker })
    37	        break
    38	      case 'assignPartyDamage':
    39	        for (const assignments of legalPartyDamageAssignments(state)) out.push({ type: 'assignPartyDamage', player, assignments })
    40	        break
    41	      case 'chooseTargets':
    42	        // Σ C(N, k) for k in min..max. `max` is the printed "up to N" (≤ 2 everywhere in the C1 pool) and N is
    43	        // one zone of one or both fields, so the bound is ~C(20,2) = 190 commands. A clause printing "up to 4"
    44	        // over a large Break Zone would need a candidate cap here — spec C1-6 flagged the combinatorics.
    45	        for (let k = pending.min; k <= pending.max; k++) {
    46	          for (const targets of combinations([...pending.candidates], k)) out.push({ type: 'chooseTargets', player, targets })
    47	        }
    48	        break
    49	      case 'chooseMode':
    50	        // Σ C(modes, k). `modes` is a printed list of 2–3, so this is a handful of commands.
    51	        for (let k = pending.min; k <= pending.max; k++) {
    52	          for (const modes of combinations(pending.labels.map((_, i) => i), k)) out.push({ type: 'chooseMode', player, modes })
    53	        }
    54	        break
    55	    }
    56	    return out
    57	  }
    58	  switch (state.phase) {
    59	    case 'main1':
    60	    case 'main2': {
    61	      for (const card of state.players[player].hand) {
    62	        if (castCheck(state, player, card) !== null) continue
    63	        const type = defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter'
    64	        for (const payment of enumeratePayments(state, player, card)) out.push({ type, player, card, payment })
    65	      }
    66	      for (const c of activationsFor(state, player)) out.push(c)
    67	      out.push({ type: 'pass', player })
    68	      break
    69	    }
    70	    case 'attack': {
    71	      if (state.attack?.step === 'declaration') {
    72	        for (const attackers of legalAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
    73	        out.push({ type: 'pass', player })
    74	      }
    75	      break
    76	    }
    77	    default:
    78	      break   // setup/active/draw/end never wait for a non-pending command
    79	  }
    80	  return out
    81	}
    82	
    83	/**
    84	 * Every legal activation for `player`, one per (source card, clause, minimal payment).
    85	 *
    86	 * Scans the three zones an activated ability can live in rather than just the field: `sourceZone` is a
    87	 * declared precondition on the ability (spec C3-3), so Geomancer's hand-only ability and a future Break-Zone
    88	 * ability enumerate through this same path instead of needing their own.
    89	 */
    90	function activationsFor(state: GameState, player: PlayerId): Command[] {
    91	  const out: Command[] = []
    92	  const ps = state.players[player]
    93	  const sources = [...ps.hand, ...ps.breakZone, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id)]
    94	  for (const source of sources) {
    95	    for (const ability of defOf(state, source).abilities ?? []) {
    96	      if (ability.trigger.kind !== 'activated') continue
    97	      if (activationCheck(state, player, source, ability.id) !== null) continue
    98	      const req = abilityCpRequirement(source, ability.trigger.cost)
    99	      for (const payment of enumeratePaymentsFor(state, player, req)) {
   100	        out.push({ type: 'activateAbility', player, source, abilityId: ability.id, payment })
   101	      }
   102	    }
   103	  }
   104	  return out
   105	}
     1	import type { PlayerId, Element, CardType, Keyword } from './types.js'
     2	import type { Phase, AttackStep, GameResult, CardId } from './state.js'
     3	import type { FieldFlag } from './abilities.js'
     4	
     5	export type Event =
     6	  | { type: 'firstPlayerChosen'; player: PlayerId }
     7	  | { type: 'mulligan'; player: PlayerId; redraw: boolean }
     8	  | { type: 'turnStarted'; turn: number; player: PlayerId }
     9	  | { type: 'phaseStarted'; phase: Phase; step?: AttackStep }
    10	  | { type: 'activated'; player: PlayerId; cards: CardId[] }
    11	  | { type: 'drew'; player: PlayerId; count: number }
    12	  | { type: 'cpGenerated'; player: PlayerId; cp: Element[] }
    13	  | { type: 'discarded'; player: PlayerId; card: CardId; reason: 'cp' | 'handSize' }
    14	  | { type: 'cast'; player: PlayerId; card: CardId; cardType: CardType }
    15	  /** An activated ability was used (spec C3-1) — activated, NOT triggered; the log must not conflate them. */
    16	  | { type: 'abilityActivated'; player: PlayerId; card: CardId; abilityId: string }
    17	  /**
    18	   * A card put into the Break Zone to PAY for its own ability. Deliberately not `brokenByAbility`: this is not
    19	   * a break (§15.1.1.3.2), so anything counting breaks must not count it.
    20	   */
    21	  | { type: 'paidToBreakZone'; player: PlayerId; card: CardId }
    22	  | { type: 'summonResolvedNoEffect'; card: CardId }
    23	  /**
    24	   * Coverage is per CLAUSE (spec C1-9). `clauses` counts the printed clauses still unimplemented; it is OMITTED
    25	   * when nothing on the card is implemented, which keeps the shape of the vanilla-pool log line unchanged.
    26	   */
    27	  | { type: 'unimplementedAbility'; card: CardId; code: string; clauses?: number }
    28	  | { type: 'attackDeclared'; player: PlayerId; attackers: CardId[] }
    29	  | { type: 'blockDeclared'; player: PlayerId; blocker: CardId | null }
    30	  | { type: 'battleDamage'; source: CardId; target: CardId; amount: number }
    31	  | { type: 'playerDamaged'; player: PlayerId; card: CardId }
    32	  | { type: 'exBurstSkipped'; player: PlayerId; card: CardId }
    33	  | { type: 'broken'; card: CardId }                                   // §12.4.5 damage ≥ power
    34	  | { type: 'putIntoBreakZone'; card: CardId; reason: 'zeroPower' }     // §12.4.4
    35	  // --- ability resolution (spec C1-3) ---
    36	  | { type: 'abilityTriggered'; player: PlayerId; card: CardId; abilityId: string }
    37	  /** The clause had no legal target, so it did nothing. Never an error — half the pool can find itself here. */
    38	  | { type: 'abilityNoLegalTarget'; card: CardId; abilityId: string }
    39	  | { type: 'dulled'; card: CardId }
    40	  | { type: 'abilityDamage'; source: CardId; target: CardId; amount: number }
    41	  | { type: 'powerModified'; card: CardId; amount: number }
    42	  | { type: 'keywordGranted'; card: CardId; keyword: Keyword }
    43	  | { type: 'flagGranted'; card: CardId; flag: FieldFlag }
    44	  | { type: 'returnedToHand'; player: PlayerId; card: CardId }
    45	  | { type: 'brokenByAbility'; card: CardId; source: CardId }
    46	  | { type: 'breakPrevented'; card: CardId; flag: FieldFlag }
    47	  | { type: 'gameOver'; result: GameResult }
     1	import type { CardDef, PlayerId } from './types.js'
     2	import type { AbilityTrigger } from './abilities.js'
     3	import type { CardId, FieldCard, GameState } from './state.js'
     4	import { MAX_BACKUPS, defOf, updatePlayer } from './state.js'
     5	import type { Payment } from './commands.js'
     6	import type { Event } from './events.js'
     7	import { IllegalCommandError } from './errors.js'
     8	import { canPay, generateCp, pay, requiredElements } from './cp.js'
     9	import { enqueueTrigger } from './resolve.js'
    10	
    11	export function castCheck(state: GameState, player: PlayerId, card: CardId): string | null {
    12	  if (state.result) return 'game is over'
    13	  // MVP0-SIMPLIFICATION: Summons are also castable in the Attack Phase (§9.3.1.6); that window needs the stack (MVP3)
    14	  if (state.phase !== 'main1' && state.phase !== 'main2') return 'characters and summons can only be cast in a main phase (§11.4.1; MVP0 restriction for summons)'
    15	  const ps = state.players[player]
    16	  if (!ps.hand.includes(card)) return 'card is not in your hand'
    17	  if (state.priority !== player) return 'you do not have priority'
    18	  if (state.pending) return 'a decision is pending'
    19	  const def = defOf(state, card)
    20	  if (def.type === 'monster') return 'monsters unsupported in MVP0'   // MVP0-SIMPLIFICATION: Monster-type cards are entirely out of scope (pool has none); §7.7 Monster-specific casting rules are unimplemented
    21	  // MVP0-SIMPLIFICATION: §7.7.4 is normally a rule process (§12.4.8) that keeps a 6th Backup off the field; here casting one is simply illegal.
    22	  if (def.type === 'backup' && ps.backups.length >= MAX_BACKUPS) return `you already control ${MAX_BACKUPS} backups (§7.7.4)`
    23	  if (def.type !== 'summon' && !def.generic) {
    24	    // MVP0-SIMPLIFICATION: §7.7.3 only prohibits *simultaneous* deployment; casting a second non-generic
    25	    // same-name Character is legal and §12.4.6 then puts ALL copies into the Break Zone as a rule process.
    26	    // Here the cast is simply illegal. §12.4.6/§12.4.7 are MVP3 work.
    27	    const clash = [...ps.forwards, ...ps.backups].some((c) => { const d = defOf(state, c.id); return !d.generic && d.name === def.name })
    28	    if (clash) return `you already control a non-generic character with the same name (§7.7.3)`
    29	  }
    30	  return null
    31	}
    32	
    33	function checkedPay(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
    34	  const def = defOf(state, card)
    35	  const cp = generateCp(state, player, payment, card)
    36	  if (!canPay(def.cost, requiredElements(def), cp)) throw new IllegalCommandError(`payment does not cover cost ${def.cost} ${def.elements.join('/')}`)
    37	  return pay(state, player, payment)
    38	}
    39	
    40	/**
    41	 * Coverage is per CLAUSE (spec C1-9). A card with an AST for 1 of its 3 printed clauses must still warn about
    42	 * the other 2, so the log stays honest about what the player is actually getting. `clauses` is omitted when
    43	 * nothing at all is implemented — the vanilla-pool log line keeps the shape it has had since rung A.
    44	 */
    45	function warnUnimplemented(def: CardDef, card: CardId, events: Event[]): void {
    46	  const printed = def.abilityClauses ?? (def.hasAbilities ? 1 : 0)
    47	  const implemented = def.abilities?.length ?? 0
    48	  const missing = Math.max(0, printed - implemented)
    49	  if (missing === 0) return
    50	  if (implemented === 0) events.push({ type: 'unimplementedAbility', card, code: def.code })
    51	  else events.push({ type: 'unimplementedAbility', card, code: def.code, clauses: missing })
    52	}
    53	
    54	/** Queue every implemented clause with this trigger, in printed order (spec C1-4: no stack, they drain immediately). */
    55	function dispatch(state: GameState, def: CardDef, card: CardId, controller: PlayerId, trigger: AbilityTrigger): GameState {
    56	  let s = state
    57	  for (const ability of def.abilities ?? []) if (ability.trigger.kind === trigger.kind) s = enqueueTrigger(s, card, controller, ability)
    58	  return s
    59	}
    60	
    61	export function applyCastCharacter(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
    62	  const why = castCheck(state, player, card)
    63	  if (why) throw new IllegalCommandError(why)
    64	  const def = defOf(state, card)
    65	  if (def.type === 'summon') throw new IllegalCommandError('use castSummon for summons')
    66	  const [paid, events] = checkedPay(state, player, card, payment)
    67	  const fc: FieldCard = { id: card, status: def.type === 'backup' ? 'dull' : 'active', damage: 0, enteredTurn: state.turn, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] }
    68	  let s = updatePlayer(paid, player, (ps) => ({
    69	    ...ps,
    70	    hand: ps.hand.filter((id) => id !== card),
    71	    forwards: def.type === 'forward' ? [...ps.forwards, fc] : ps.forwards,
    72	    backups: def.type === 'backup' ? [...ps.backups, fc] : ps.backups,
    73	  }))
    74	  events.push({ type: 'cast', player, card, cardType: def.type })
    75	  warnUnimplemented(def, card, events)
    76	  // `enterField`, not `cast`: C2's Hugh Yurg puts a Character onto the field without casting it (spec C1-2).
    77	  s = dispatch(s, def, card, player, { kind: 'enterField' })
    78	  return [s, events]
    79	}
    80	
    81	export function applyCastSummon(state: GameState, player: PlayerId, card: CardId, payment: Payment): [GameState, Event[]] {
    82	  const why = castCheck(state, player, card)
    83	  if (why) throw new IllegalCommandError(why)
    84	  const def = defOf(state, card)
    85	  if (def.type !== 'summon') throw new IllegalCommandError('not a summon')
    86	  const [paid, events] = checkedPay(state, player, card, payment)
    87	  // MVP0-SIMPLIFICATION: no stack (§7.10.1) — the summon goes straight to the break zone and its effect, if
    88	  // implemented, resolves immediately from there. `Frame.source` is allowed to be a card that has left the field.
    89	  let s = updatePlayer(paid, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== card), breakZone: [...ps.breakZone, card] }))
    90	  events.push({ type: 'cast', player, card, cardType: 'summon' })
    91	  warnUnimplemented(def, card, events)
    92	  const resolves = (def.abilities ?? []).some((a) => a.trigger.kind === 'summonResolve')
    93	  s = dispatch(s, def, card, player, { kind: 'summonResolve' })
    94	  if (!resolves) events.push({ type: 'summonResolvedNoEffect', card })
    95	  return [s, events]
    96	}
     1	import type { PlayerId } from './types.js'
     2	import { opponentOf } from './types.js'
     3	import type { CardId, GameState } from './state.js'
     4	import { HAND_SIZE_LIMIT, updatePlayer } from './state.js'
     5	import type { Event } from './events.js'
     6	import { IllegalCommandError } from './errors.js'
     7	import { runRuleProcesses } from './rules.js'
     8	import { enterAttackDeclaration } from './resolve.js'
     9	// Re-exported so every existing importer of `drawCards` from this module keeps working (spec C3-9).
    10	export { drawCards } from './draw.js'
    11	import { drawCards } from './draw.js'
    12	
    13	
    14	export function startTurn(state: GameState, turn: number, player: PlayerId): [GameState, Event[]] {
    15	  const events: Event[] = [{ type: 'turnStarted', turn, player }]
    16	  let s: GameState = { ...state, turn, turnPlayer: player, priority: player, attack: null, pending: null }
    17	  // §9.1 Active Phase
    18	  s = { ...s, phase: 'active' }; events.push({ type: 'phaseStarted', phase: 'active' })
    19	  const dulled: CardId[] = []
    20	  s = updatePlayer(s, player, (ps) => ({
    21	    ...ps,
    22	    forwards: ps.forwards.map((c) => { if (c.status === 'dull') dulled.push(c.id); return { ...c, status: 'active' } }),
    23	    backups: ps.backups.map((c) => { if (c.status === 'dull') dulled.push(c.id); return { ...c, status: 'active' } }),
    24	  }))
    25	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
    26	  // §9.2 Draw Phase
    27	  s = { ...s, phase: 'draw' }; events.push({ type: 'phaseStarted', phase: 'draw' })
    28	  const n = turn === 1 ? 1 : 2   // §9.2.1.3
    29	  const [drawn, drawEvents] = drawCards(s, player, n)
    30	  s = drawn; events.push(...drawEvents)
    31	  if (s.result) return [s, events]
    32	  // §9.3 Main Phase 1
    33	  s = { ...s, phase: 'main1' }; events.push({ type: 'phaseStarted', phase: 'main1' })
    34	  return [s, events]
    35	}
    36	
    37	export function applyPass(state: GameState, player: PlayerId): [GameState, Event[]] {
    38	  if (state.result) throw new IllegalCommandError('game is over')
    39	  if (state.pending) throw new IllegalCommandError('a decision is pending')
    40	  if (state.priority !== player) throw new IllegalCommandError('you do not hold priority')
    41	  if (state.phase === 'attack' && state.attack?.step !== 'declaration') throw new IllegalCommandError('cannot pass during this attack step')
    42	  switch (state.phase) {
    43	    case 'main1':
    44	      // §10.1.1 Attack Preparation Step — MVP0-SIMPLIFICATION: nothing triggers here in C1, so advance straight to
    45	      // declaration. C2's Cloud clause instead enqueues its trigger and sets `resolution.continuation` to
    46	      // 'enterAttackDeclaration', which drains to this exact transition.
    47	      return enterAttackDeclaration(state, player)
    48	    case 'attack':   // declaration step, checked above; §10.1.4.6
    49	      return [{ ...state, phase: 'main2', attack: null, priority: player }, [{ type: 'phaseStarted', phase: 'main2' }]]
    50	    case 'main2':
    51	      return beginEndPhase(state)
    52	    default:
    53	      throw new IllegalCommandError(`pass not applicable in phase ${state.phase}`)
    54	  }
    55	}
    56	
    57	function beginEndPhase(state: GameState): [GameState, Event[]] {
    58	  const p = state.turnPlayer
    59	  const events: Event[] = [{ type: 'phaseStarted', phase: 'end' }]
    60	  const s: GameState = { ...state, phase: 'end' }
    61	  const excess = s.players[p].hand.length - HAND_SIZE_LIMIT   // §9.5.1.2
    62	  if (excess > 0) return [{ ...s, pending: { kind: 'discardToHandSize', player: p, count: excess }, priority: p }, events]
    63	  const [t, more] = finishEndPhase(s)
    64	  return [t, [...events, ...more]]
    65	}
    66	
    67	export function applyDiscardToHandSize(state: GameState, player: PlayerId, cards: CardId[]): [GameState, Event[]] {
    68	  const pending = state.pending
    69	  if (pending?.kind !== 'discardToHandSize' || pending.player !== player) throw new IllegalCommandError('no discard decision owed by this player')
    70	  if (cards.length !== pending.count || new Set(cards).size !== cards.length) throw new IllegalCommandError(`discard exactly ${pending.count} distinct cards`)
    71	  for (const id of cards) if (!state.players[player].hand.includes(id)) throw new IllegalCommandError(`${id} is not in your hand`)
    72	  let s = updatePlayer(state, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => !cards.includes(id)), breakZone: [...ps.breakZone, ...cards] }))
    73	  const events: Event[] = cards.map((card) => ({ type: 'discarded', player, card, reason: 'handSize' }))
    74	  s = { ...s, pending: null }
    75	  const [t, more] = finishEndPhase(s)
    76	  return [t, [...events, ...more]]
    77	}
    78	
    79	export function finishEndPhase(state: GameState): [GameState, Event[]] {
    80	  // §9.5.1.3.1 remove damage; §9.5.1.3.2 end EVERY "until end of turn" effect — granted keywords, `powerBonus`
    81	  // and the protection `flags` (spec C1-7) all expire together; reset per-turn flags
    82	  let s = state
    83	  for (const p of [0, 1] as const) {
    84	    s = updatePlayer(s, p, (ps) => ({
    85	      ...ps,
    86	      forwards: ps.forwards.map((c) => ({ ...c, damage: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] })),
    87	      backups: ps.backups.map((c) => ({ ...c, granted: [], powerBonus: 0, flags: [] })),
    88	    }))
    89	  }
    90	  const [ruled, events] = runRuleProcesses(s)   // §9.5.1.4
    91	  if (ruled.result) return [ruled, events]
    92	  const [next, more] = startTurn(ruled, ruled.turn + 1, opponentOf(ruled.turnPlayer))   // §9.5.1.5
    93	  return [next, [...events, ...more]]
    94	}

exec
/bin/zsh -lc "nl -ba packages/engine/src/resolve.ts | sed -n '1,220p'; nl -ba packages/engine/src/resolve.ts | sed -n '221,460p'; nl -ba packages/engine/src/resolve.ts | sed -n '461,680p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { Ability, AbilityTrigger, Effect, Frame, TargetFilter, TargetSpec, TriggerEvent, TriggerWhose } from './abilities.js'
     2	// Type-only, so it is erased at compile time and creates no runtime cycle with rules.ts (which imports this module).
     3	import type { ZoneTransition } from './rules.js'
     4	import { drawCards } from './draw.js'
     5	import { MAX_RESOLUTION_STEPS } from './abilities.js'
     6	import type { CardId, FieldCard, GameState, Pending } from './state.js'
     7	import { findFieldCard, updatePlayer } from './state.js'
     8	import type { PlayerId } from './types.js'
     9	import { opponentOf } from './types.js'
    10	import type { Event } from './events.js'
    11	import { IllegalCommandError } from './errors.js'
    12	
    13	/**
    14	 * The ability executor (spec C1-3). No card-specific code lives here: this is an interpreter for the `Effect`
    15	 * AST in abilities.ts, and `packages/cards` writes the ASTs.
    16	 *
    17	 * LAYERING — this module imports nothing from `rules.ts`, `phases.ts` or `apply.ts`, because `rules.ts` imports
    18	 * `enqueueTrigger` from here (spec C1-8 wants zone transitions to enqueue their own triggers at the moment of
    19	 * removal). Interleaving resolution with rule processes is therefore the outer reducer's job: `settle` in
    20	 * `apply.ts` alternates `runRuleProcesses` and `drainResolution` until both are quiet.
    21	 *
    22	 * MVP0-SIMPLIFICATION (spec C1-4): there is no stack and no response window. A triggered clause resolves
    23	 * immediately, in trigger order, and the opponent cannot answer it.
    24	 *
    25	 * C1's atomicity rule is REFINED by spec C2-6, not replaced: a frame is atomic WITHIN itself, across every
    26	 * prompt it raises; rule processes run BETWEEN frames. `drainResolution` therefore completes exactly one frame
    27	 * and yields while queued work remains, so `settle` gets its §12.3 pass in before the next frame starts.
    28	 * Without that yield, Luso's "break it" resolved BEFORE §12.4.5 had broken the Forward its own damage killed —
    29	 * backwards under CR §§12.3–12.4.5.
    30	 */
    31	
    32	// ---------------------------------------------------------------------------
    33	// Queueing
    34	// ---------------------------------------------------------------------------
    35	
    36	/** Push a triggered clause onto the agenda. The frame starts at path `[]` — the top of `ability.effects`. */
    37	export function enqueueTrigger(state: GameState, source: CardId, controller: PlayerId, ability: Ability, triggerEvent: TriggerEvent | null = null): GameState {
    38	  const frame: Frame = { abilityId: ability.id, source, controller, path: [], chosen: [], modes: [], triggerEvent }
    39	  return { ...state, resolution: { ...state.resolution, queue: [...state.resolution.queue, frame] } }
    40	}
    41	
    42	/**
    43	 * One card dealing one lot of damage to one recipient — the SINGLE record combat damage (`attack.ts`) and the
    44	 * ability `damage` effect both produce, because the printed text says "deals damage", not "deals combat
    45	 * damage" (spec C2-7). Exactly one of `target`/`victim` is non-null.
    46	 *
    47	 * `sourceController` is passed in rather than derived: the source may be about to leave the field, and party
    48	 * attribution is by MEMBERSHIP, not array position (spec C2-8).
    49	 */
    50	export interface DamageOccurrence {
    51	  readonly source: CardId
    52	  readonly sourceController: PlayerId
    53	  readonly target: CardId | null
    54	  readonly victim: PlayerId | null
    55	  readonly amount: number
    56	}
    57	
    58	/**
    59	 * Queue the `dealtDamage` clauses of every damage source in `hits`, in hit order. Damage inside one batch is
    60	 * simultaneous (§10.1.4.2), so callers apply ALL of it first and dispatch once — a source that is about to be
    61	 * broken by the same batch still triggers, exactly as a zone-change watcher does (spec C2-4).
    62	 */
    63	export function enqueueDamageTriggers(state: GameState, hits: readonly DamageOccurrence[]): GameState {
    64	  let s = state
    65	  for (const h of hits) {
    66	    if (h.target === null && h.victim === null) continue
    67	    const to = h.target !== null ? 'forward' : 'player'
    68	    const code = state.cards[h.source]?.code
    69	    const event: TriggerEvent = { kind: 'damage', source: h.source, sourceController: h.sourceController, target: h.target, victim: h.victim, amount: h.amount }
    70	    for (const a of (code === undefined ? undefined : state.defs[code])?.abilities ?? []) {
    71	      if (a.trigger.kind !== 'dealtDamage' || a.trigger.to !== to) continue
    72	      // "deals damage to YOUR OPPONENT" (Luso, Prishe) is a real restriction, not decoration. It held only
    73	      // because today's single producer always damages the opponent; encoding it here means a future
    74	      // self-damage or redirect path cannot silently fire these on their own controller.
    75	      if (!damagedSideMatches(state, a.trigger.whose, h)) continue
    76	      s = enqueueTrigger(s, h.source, h.sourceController, a, event)
    77	    }
    78	  }
    79	  return s
    80	}
    81	
    82	
    83	/**
    84	 * Is the damaged side the one the clause names, relative to the SOURCE's controller (spec C2-10)?
    85	 * For damage to a Forward the side is that Forward's controller, looked up while it is still on the field —
    86	 * the pool's only `to: 'forward'` clause is unrestricted (`whose: 'any'`), so this is guarded, not exercised.
    87	 */
    88	function damagedSideMatches(state: GameState, whose: TriggerWhose, h: DamageOccurrence): boolean {
    89	  if (whose === 'any') return true
    90	  const damaged = h.victim !== null ? h.victim : h.target === null ? null : findFieldCard(state, h.target)?.owner ?? null
    91	  if (damaged === null) return true   // nothing attributable to compare against
    92	  return whose === 'self' ? damaged === h.sourceController : damaged === opponentOf(h.sourceController)
    93	}
    94	
    95	/** The clause a frame is executing, or null if the def no longer declares it (a hot-swapped card pool). */
    96	export function abilityOf(state: GameState, frame: Frame): Ability | null {
    97	  const code = state.cards[frame.source]?.code
    98	  const def = code === undefined ? undefined : state.defs[code]
    99	  return def?.abilities?.find((a) => a.id === frame.abilityId) ?? null
   100	}
   101	
   102	// ---------------------------------------------------------------------------
   103	// Targeting
   104	// ---------------------------------------------------------------------------
   105	
   106	function defFor(state: GameState, id: CardId) {
   107	  const code = state.cards[id]?.code
   108	  return code === undefined ? undefined : state.defs[code]
   109	}
   110	
   111	function matchesFilter(state: GameState, source: CardId, id: CardId, filter: TargetFilter | undefined): boolean {
   112	  if (!filter) return true
   113	  const def = defFor(state, id)
   114	  if (!def) return false
   115	  if (filter.type !== undefined && def.type !== filter.type) return false
   116	  // "Character" is Forward, Backup OR Monster and never Summon (§7.2), which a single `type` cannot say — both
   117	  // Prishe's and Luso's Break-Zone retrievals need it (spec C2-9). `type` and `types` conjoin: a filter carrying
   118	  // both must satisfy both.
   119	  if (filter.types !== undefined && !filter.types.includes(def.type)) return false
   120	  if (filter.element !== undefined && !def.elements.includes(filter.element)) return false
   121	  if (filter.maxCost !== undefined && def.cost > filter.maxCost) return false
   122	  if (filter.excludeSource && id === source) return false
   123	  if (filter.excludeSourceName) {
   124	    const src = defFor(state, source)
   125	    if (src && src.name === def.name) return false
   126	  }
   127	  return true
   128	}
   129	
   130	/**
   131	 * The legal targets of one `TargetSpec`, in a fixed player-0-then-1 order so a live state and its
   132	 * determinisation enumerate the same candidates in the same order (spec C1-A6).
   133	 */
   134	export function targetCandidates(state: GameState, source: CardId, controller: PlayerId, spec: TargetSpec): CardId[] {
   135	  const owners: readonly PlayerId[] = spec.controller === 'any' ? [0, 1]
   136	    : spec.controller === 'self' ? [controller] : [opponentOf(controller)]
   137	  const out: CardId[] = []
   138	  for (const p of ([0, 1] as const).filter((q) => owners.includes(q))) {
   139	    const ps = state.players[p]
   140	    const ids = spec.zone === 'breakZone' ? ps.breakZone
   141	      : (spec.zone === 'forwards' ? ps.forwards : ps.backups).map((c) => c.id)
   142	    for (const id of ids) if (matchesFilter(state, source, id, spec.filter)) out.push(id)
   143	  }
   144	  return out
   145	}
   146	
   147	// ---------------------------------------------------------------------------
   148	// Zone plumbing
   149	// ---------------------------------------------------------------------------
   150	
   151	function setFieldCard(state: GameState, id: CardId, f: (c: FieldCard) => FieldCard): GameState {
   152	  const loc = findFieldCard(state, id)
   153	  if (!loc) return state
   154	  return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
   155	    ? { ...ps, forwards: ps.forwards.map((c) => (c.id === id ? f(c) : c)) }
   156	    : { ...ps, backups: ps.backups.map((c) => (c.id === id ? f(c) : c))}))
   157	}
   158	
   159	export function removeFromField(state: GameState, id: CardId): GameState {
   160	  const loc = findFieldCard(state, id)
   161	  if (!loc) return state
   162	  return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
   163	    ? { ...ps, forwards: ps.forwards.filter((c) => c.id !== id) }
   164	    : { ...ps, backups: ps.backups.filter((c) => c.id !== id) }))
   165	}
   166	
   167	/** §7.10: a card always goes to its OWNER's zone, not its controller's. Returns null if the card is nowhere movable. */
   168	function toHand(state: GameState, id: CardId): GameState | null {
   169	  const owner = state.cards[id]?.owner
   170	  if (owner === undefined) return null
   171	  let s = state
   172	  if (findFieldCard(state, id)) s = removeFromField(s, id)
   173	  else {
   174	    const holder = ([0, 1] as const).find((p) => state.players[p].breakZone.includes(id))
   175	    if (holder === undefined) return null
   176	    s = updatePlayer(s, holder, (ps) => ({ ...ps, breakZone: ps.breakZone.filter((x) => x !== id) }))
   177	  }
   178	  return updatePlayer(s, owner, (ps) => ({ ...ps, hand: [...ps.hand, id] }))
   179	}
   180	
   181	// ---------------------------------------------------------------------------
   182	// The walker
   183	// ---------------------------------------------------------------------------
   184	
   185	interface Ctx {
   186	  state: GameState
   187	  events: Event[]
   188	  source: CardId
   189	  controller: PlayerId
   190	  abilityId: string
   191	  /** Program counter, one index per nesting level. `chooseModes` owns TWO levels: mode ordinal, then effect index. */
   192	  path: number[]
   193	  chosen: CardId[]
   194	  modes: number[]
   195	  /** What fired this clause, for `onSubject` and narration; null for self-triggers (spec C2-5). */
   196	  triggerEvent: TriggerEvent | null
   197	  /** The path the frame was suspended at; execution rejoins it instead of replaying the effects already run. */
   198	  resume: readonly number[]
   199	  suspend: Pending | null
   200	  steps: number
   201	}
   202	
   203	/**
   204	 * Spec C1-5: every effect step is counted, the count lives on `GameState` and therefore PERSISTS across player
   205	 * choices. A call-depth cap would not see a trigger cycle that launders itself through a `chooseTargets` prompt.
   206	 */
   207	function step(ctx: Ctx): void {
   208	  ctx.steps++
   209	  if (ctx.steps > MAX_RESOLUTION_STEPS) {
   210	    throw new Error(`ability ${ctx.abilityId} on card ${ctx.source} exceeded ${MAX_RESOLUTION_STEPS} resolution steps (spec C1-5) — trigger cycle?`)
   211	  }
   212	}
   213	
   214	function noLegalTarget(ctx: Ctx): void {
   215	  // Spec C1-7: an ability that cannot legally resolve is a NO-OP that logs, never an error.
   216	  ctx.events.push({ type: 'abilityNoLegalTarget', card: ctx.source, abilityId: ctx.abilityId })
   217	}
   218	
   219	function runEffects(ctx: Ctx, effects: readonly Effect[], depth: number, onSpine: boolean): void {
   220	  const start = onSpine ? (ctx.resume[depth] ?? 0) : 0
   221	  for (let i = start; i < effects.length; i++) {
   222	    const eff = effects[i]
   223	    if (!eff) continue
   224	    ctx.path = [...ctx.path.slice(0, depth), i]
   225	    // Still on the resume spine AND a deeper index was recorded ⇒ this node's choice is already answered:
   226	    // descend into its children rather than raising the same prompt again.
   227	    const answered = onSpine && i === start && depth + 1 < ctx.resume.length
   228	    runEffect(ctx, eff, depth, answered)
   229	    if (ctx.suspend) return
   230	  }
   231	}
   232	
   233	function runEffect(ctx: Ctx, eff: Effect, depth: number, answered: boolean): void {
   234	  step(ctx)
   235	  switch (eff.kind) {
   236	    case 'chooseTargets': {
   237	      if (answered) { runEffects(ctx, eff.then, depth + 1, true); return }
   238	      const candidates = targetCandidates(ctx.state, ctx.source, ctx.controller, eff.from)
   239	      if (candidates.length === 0 || eff.min > candidates.length) { noLegalTarget(ctx); return }
   240	      ctx.suspend = { kind: 'chooseTargets', player: ctx.controller, min: eff.min, max: Math.min(eff.max, candidates.length), candidates }
   241	      return
   242	    }
   243	    case 'chooseModes': {
   244	      if (answered) {
   245	        const from = ctx.resume[depth + 1] ?? 0
   246	        for (let k = from; k < ctx.modes.length; k++) {
   247	          ctx.path = [...ctx.path.slice(0, depth + 1), k]
   248	          const mode = eff.modes[ctx.modes[k] ?? -1]
   249	          if (mode) runEffects(ctx, mode.effects, depth + 2, k === from)
   250	          if (ctx.suspend) return
   251	        }
   252	        return
   253	      }
   254	      if (eff.modes.length === 0 || eff.min > eff.modes.length) { noLegalTarget(ctx); return }
   255	      ctx.suspend = { kind: 'chooseMode', player: ctx.controller, min: eff.min, max: Math.min(eff.max, eff.modes.length), labels: eff.modes.map((m) => m.label) }
   256	      return
   257	    }
   258	    case 'forEach': {
   259	      // Untargeted, so it raises no prompt — and it must not contain one either: `Frame.chosen` is a single
   260	      // innermost binding, so a suspension inside `do` could not restore the per-iteration card on resume.
   261	      const saved = ctx.chosen
   262	      for (const id of targetCandidates(ctx.state, ctx.source, ctx.controller, eff.from)) {
   263	        ctx.chosen = [id]
   264	        runEffects(ctx, eff.do, depth + 1, false)
   265	        if (ctx.suspend) throw new Error(`ability ${ctx.abilityId}: forEach.do must not contain a suspending effect`)
   266	      }
   267	      ctx.chosen = saved
   268	      return
   269	    }
   270	    case 'onSubject': {
   271	      // The card the trigger was ABOUT — Luso's "break it" (spec C2-5). Same fixed-binding shape as
   272	      // `forEach`, so `do` may not suspend: `Frame.chosen` holds one innermost binding and a prompt inside
   273	      // `do` could not restore the subject on resume. A trigger with no card subject is a no-op.
   274	      const ev = ctx.triggerEvent
   275	      const subject = ev === null ? null : ev.kind === 'damage' ? ev.target : ev.card
   276	      if (subject === null) return
   277	      const saved = ctx.chosen
   278	      ctx.chosen = [subject]
   279	      runEffects(ctx, eff.do, depth + 1, false)
   280	      if (ctx.suspend) throw new Error(`ability ${ctx.abilityId}: onSubject.do must not contain a suspending effect`)
   281	      ctx.chosen = saved
   282	      return
   283	    }
   284	    case 'dull':
   285	      for (const id of ctx.chosen) {
   286	        const loc = findFieldCard(ctx.state, id)
   287	        if (!loc || loc.card.status === 'dull') continue
   288	        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, status: 'dull' }))
   289	        ctx.events.push({ type: 'dulled', card: id })
   290	      }
   291	      return
   292	    case 'damage': {
   293	      const hits: DamageOccurrence[] = []
   294	      for (const id of ctx.chosen) {
   295	        const loc = findFieldCard(ctx.state, id)
   296	        if (!loc || loc.zone !== 'forwards') continue   // only Forwards carry damage
   297	        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, damage: c.damage + eff.amount }))
   298	        ctx.events.push({ type: 'abilityDamage', source: ctx.source, target: id, amount: eff.amount })
   299	        hits.push({ source: ctx.source, sourceController: ctx.controller, target: id, victim: null, amount: eff.amount })
   300	      }
   301	      ctx.state = enqueueDamageTriggers(ctx.state, hits)   // ability damage triggers exactly as combat damage does (spec C2-7)
   302	      // §12.4.5 turns this into a break; `settle` runs the rule processes, which honour `cannotBeBroken`. Because
   303	      // `drainResolution` yields between frames (spec C2-6), that process resolves BEFORE the trigger just queued.
   304	      return
   305	    }
   306	    case 'breakCard': {
   307	      // An ability break is a field→Break Zone transition like any other, and Lightning's "when a Forward
   308	      // opponent controls is put from the field into the Break Zone" is cause-agnostic. This path used to do its
   309	      // own zone move and never produce a transition, so NO observer clause fired on an ability break —
   310	      // ~130 of ~220 ability breaks on the shipped gate had an eligible watcher standing, and every test,
   311	      // invariant and fuzzer run was green while it silently missed them.
   312	      const pre = ctx.state   // watchers are read PRE-move, so one that breaks itself here still triggers
   313	      const moved: ZoneTransition[] = []
   314	      for (const id of ctx.chosen) {
   315	        const loc = findFieldCard(ctx.state, id)
   316	        if (!loc) continue
   317	        if (loc.card.flags.includes('cannotBeBroken')) { ctx.events.push({ type: 'breakPrevented', card: id, flag: 'cannotBeBroken' }); continue }
   318	        // `loc.owner` is the field the card sat on — its CONTROLLER. Real ownership is `CardInstance.owner`, and
   319	        // §12.4.4/§15.1.1.3 sends a broken card to its OWNER's Break Zone. They coincide across the MVP0 pool.
   320	        const owner = ctx.state.cards[id]?.owner ?? loc.owner
   321	        moved.push({
   322	          card: id, controller: loc.owner, owner,
   323	          from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'ability',
   324	          cause: ctx.source, causeController: ctx.controller, snapshot: loc.card,
   325	        })
   326	        ctx.state = updatePlayer(removeFromField(ctx.state, id), owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, id] }))
   327	        ctx.events.push({ type: 'brokenByAbility', card: id, source: ctx.source })
   328	      }
   329	      ctx.state = enqueueZoneChangeTriggers(pre, ctx.state, moved)
   330	      return
   331	    }
   332	    case 'addPower':
   333	      for (const id of ctx.chosen) {
   334	        if (!findFieldCard(ctx.state, id)) continue
   335	        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, powerBonus: c.powerBonus + eff.amount }))
   336	        ctx.events.push({ type: 'powerModified', card: id, amount: eff.amount })
   337	      }
   338	      return
   339	    case 'grantKeyword':
   340	      for (const id of ctx.chosen) {
   341	        const loc = findFieldCard(ctx.state, id)
   342	        if (!loc || loc.card.granted.includes(eff.keyword)) continue
   343	        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, granted: [...c.granted, eff.keyword] }))
   344	        ctx.events.push({ type: 'keywordGranted', card: id, keyword: eff.keyword })
   345	      }
   346	      return
   347	    case 'grantFlag':
   348	      for (const id of ctx.chosen) {
   349	        const loc = findFieldCard(ctx.state, id)
   350	        if (!loc || loc.card.flags.includes(eff.flag)) continue
   351	        ctx.state = setFieldCard(ctx.state, id, (c) => ({ ...c, flags: [...c.flags, eff.flag] }))
   352	        ctx.events.push({ type: 'flagGranted', card: id, flag: eff.flag })
   353	      }
   354	      return
   355	    case 'moveToHand':
   356	      for (const id of ctx.chosen) {
   357	        const moved = toHand(ctx.state, id)
   358	        if (!moved) continue
   359	        ctx.state = moved
   360	        ctx.events.push({ type: 'returnedToHand', player: ctx.state.cards[id]?.owner ?? ctx.controller, card: id })
   361	      }
   362	      return
   363	    case 'draw': {
   364	      // The ability's CONTROLLER draws, not the turn player: Miner's draw is Miner's controller's.
   365	      const [drawn, drawEvents] = drawCards(ctx.state, ctx.controller, eff.count)
   366	      ctx.state = drawn
   367	      ctx.events.push(...drawEvents)
   368	      return
   369	    }
   370	    default: { const _exhaustive: never = eff; return _exhaustive }
   371	  }
   372	}
   373	
   374	interface FrameResult { state: GameState; events: Event[]; pending: Pending | null; frame: Frame; steps: number }
   375	
   376	function runFrame(state: GameState, frame: Frame): FrameResult {
   377	  const ability = abilityOf(state, frame)
   378	  const base: FrameResult = { state, events: [], pending: null, frame, steps: state.resolution.steps }
   379	  if (!ability) return base   // the clause vanished with its def; drop the frame rather than throw
   380	  const ctx: Ctx = {
   381	    state, events: [], source: frame.source, controller: frame.controller, abilityId: frame.abilityId,
   382	    path: [...frame.path], chosen: [...frame.chosen], modes: [...frame.modes],
   383	    triggerEvent: frame.triggerEvent,
   384	    resume: frame.path, suspend: null, steps: state.resolution.steps,
   385	  }
   386	  runEffects(ctx, ability.effects, 0, frame.path.length > 0)
   387	  return {
   388	    state: ctx.state, events: ctx.events, pending: ctx.suspend, steps: ctx.steps,
   389	    frame: { ...frame, path: ctx.path, chosen: ctx.chosen, modes: ctx.modes },
   390	  }
   391	}
   392	
   393	// ---------------------------------------------------------------------------
   394	// Draining
   395	// ---------------------------------------------------------------------------
   396	
   397	/** §10.1.1 Attack Preparation Step, then §10.1.2 Declaration. Shared by `pass` and by the agenda continuation. */
   398	export function enterAttackDeclaration(state: GameState, player: PlayerId): [GameState, Event[]] {
   399	  const s: GameState = { ...state, phase: 'attack', attack: { step: 'declaration', attackers: [], blocker: null }, priority: player }
   400	  return [s, [{ type: 'phaseStarted', phase: 'attack', step: 'preparation' }, { type: 'phaseStarted', phase: 'attack', step: 'declaration' }]]
   401	}
   402	
   403	/**
   404	 * Advance the agenda by exactly ONE frame: resume the active one, or start the next queued one, and run it until
   405	 * it finishes or a player must choose (the choice becomes `state.pending` and the frame stays `active`). Then
   406	 * YIELD — spec C2-6. `settle` in apply.ts owns the loop and runs §12.3 rule processes before the next frame
   407	 * starts, which is what puts §12.4.5's break ahead of the trigger that same damage queued. Draining the whole
   408	 * queue here instead would resolve Luso before the Forward it killed was broken.
   409	 *
   410	 * With the queue and the active frame both empty, the system continuation — if any — runs. Never touches an
   411	 * existing `pending`: the decision already on the table always comes first.
   412	 *
   413	 * `resolution.steps` is NOT reset here: `settle` in apply.ts resets it once the whole settlement is quiet, so a
   414	 * rule-process ⇄ trigger cycle keeps accumulating and hits the cap instead of restarting the count every pass.
   415	 */
   416	export function drainResolution(state: GameState): [GameState, Event[]] {
   417	  const events: Event[] = []
   418	  let s = state
   419	  if (s.result || s.pending) return [s, events]
   420	  let frame = s.resolution.active
   421	  if (!frame) {
   422	    const [next, ...rest] = s.resolution.queue
   423	    if (next) {
   424	      frame = next
   425	      const steps = s.resolution.steps + 1   // starting a frame is a step too, so a cycle of empty clauses is still capped
   426	      if (steps > MAX_RESOLUTION_STEPS) throw new Error(`resolution exceeded ${MAX_RESOLUTION_STEPS} steps (spec C1-5) — trigger cycle?`)
   427	      s = { ...s, resolution: { ...s.resolution, active: frame, queue: rest, steps } }
   428	      events.push({ type: 'abilityTriggered', player: frame.controller, card: frame.source, abilityId: frame.abilityId })
   429	    }
   430	  }
   431	  if (frame) {
   432	    const r = runFrame(s, frame)
   433	    s = r.state
   434	    events.push(...r.events)
   435	    s = r.pending
   436	      ? { ...s, pending: r.pending, resolution: { ...s.resolution, active: r.frame, steps: r.steps } }
   437	      : { ...s, resolution: { ...s.resolution, active: null, steps: r.steps } }
   438	    return [s, events]   // one frame per call; `settle` comes back with rule processes run
   439	  }
   440	  const continuation = s.resolution.continuation
   441	  if (continuation === 'enterAttackDeclaration') {
   442	    s = { ...s, resolution: { ...s.resolution, continuation: null } }
   443	    const [t, e] = enterAttackDeclaration(s, s.turnPlayer)
   444	    s = t; events.push(...e)
   445	  }
   446	  return [s, events]
   447	}
   448	
   449	// ---------------------------------------------------------------------------
   450	// Answering a suspended choice
   451	// ---------------------------------------------------------------------------
   452	
   453	/**
   454	 * The effect node a frame is suspended at, found by walking `path` through the AST. `apply` re-derives its
   455	 * candidates from HERE rather than trusting `state.pending`, which is only a projection of it (spec C1-6).
   456	 */
   457	function effectAt(effects: readonly Effect[], path: readonly number[], modes: readonly number[], depth: number): Effect | null {
   458	  const i = path[depth]
   459	  if (i === undefined) return null
   460	  const eff = effects[i]
   461	  if (!eff) return null
   462	  if (depth === path.length - 1) return eff
   463	  if (eff.kind === 'chooseTargets') return effectAt(eff.then, path, modes, depth + 1)
   464	  if (eff.kind === 'chooseModes') {
   465	    const k = path[depth + 1]
   466	    if (k === undefined) return null
   467	    const mode = eff.modes[modes[k] ?? -1]
   468	    return mode ? effectAt(mode.effects, path, modes, depth + 2) : null
   469	  }
   470	  return null
   471	}
   472	
   473	function suspendedNode(state: GameState): { frame: Frame; node: Effect } {
   474	  const frame = state.resolution.active
   475	  if (!frame) throw new IllegalCommandError('no ability is waiting for an answer')
   476	  const ability = abilityOf(state, frame)
   477	  if (!ability) throw new IllegalCommandError('the waiting ability no longer exists')
   478	  const node = effectAt(ability.effects, frame.path, frame.modes, 0)
   479	  if (!node) throw new IllegalCommandError('the waiting ability has no effect at its program counter')
   480	  return { frame, node }
   481	}
   482	
   483	export function applyChooseTargets(state: GameState, player: PlayerId, targets: readonly CardId[]): [GameState, Event[]] {
   484	  if (state.pending?.kind !== 'chooseTargets' || state.pending.player !== player) throw new IllegalCommandError('no target choice owed by this player')
   485	  const { frame, node } = suspendedNode(state)
   486	  if (node.kind !== 'chooseTargets') throw new IllegalCommandError('the waiting ability is not choosing targets')
   487	  if (new Set(targets).size !== targets.length) throw new IllegalCommandError('duplicate target')
   488	  const candidates = targetCandidates(state, frame.source, frame.controller, node.from)
   489	  const max = Math.min(node.max, candidates.length)
   490	  if (targets.length < node.min || targets.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} targets, got ${targets.length}`)
   491	  for (const id of targets) if (!candidates.includes(id)) throw new IllegalCommandError(`${id} is not a legal target`)
   492	  // Extending the path by one level says "the choice at this node is made" — resume runs `then`, not the prompt.
   493	  const active: Frame = { ...frame, chosen: [...targets], path: [...frame.path, 0] }
   494	  return [{ ...state, pending: null, resolution: { ...state.resolution, active } }, []]
   495	}
   496	
   497	export function applyChooseMode(state: GameState, player: PlayerId, modes: readonly number[]): [GameState, Event[]] {
   498	  if (state.pending?.kind !== 'chooseMode' || state.pending.player !== player) throw new IllegalCommandError('no mode choice owed by this player')
   499	  const { frame, node } = suspendedNode(state)
   500	  if (node.kind !== 'chooseModes') throw new IllegalCommandError('the waiting ability is not choosing modes')
   501	  if (new Set(modes).size !== modes.length) throw new IllegalCommandError('duplicate mode')
   502	  const max = Math.min(node.max, node.modes.length)
   503	  if (modes.length < node.min || modes.length > max) throw new IllegalCommandError(`choose ${node.min}..${max} modes, got ${modes.length}`)
   504	  for (const m of modes) if (!Number.isInteger(m) || m < 0 || m >= node.modes.length) throw new IllegalCommandError(`${m} is not a mode of this ability`)
   505	  const ordered = [...modes].sort((a, b) => a - b)   // "select up to 2 of the 3 following" resolves in PRINTED order
   506	  const active: Frame = { ...frame, modes: ordered, path: [...frame.path, 0, 0] }
   507	  return [{ ...state, pending: null, resolution: { ...state.resolution, active } }, []]
   508	}
   509	
   510	// ---------------------------------------------------------------------------
   511	// Zone-change watcher dispatch (spec C2-3/C2-4). Lives here, not in rules.ts, because rules.ts already imports
   512	// this module — keeping dispatch in one place avoids a runtime import cycle.
   513	// ---------------------------------------------------------------------------
   514	/**
   515	 * One trigger occurrence: a (watcher, clause, matching transition) TRIPLE (spec C2-3). CR §11.8.6 — a Lightning
   516	 * watching two opponent Forwards broken at the same instant triggers TWICE, so this is deliberately not
   517	 * collapsed to one occurrence per batch.
   518	 */
   519	interface WatcherOccurrence {
   520	  readonly transition: ZoneTransition
   521	  readonly source: CardId
   522	  readonly controller: PlayerId
   523	  readonly ability: Ability
   524	}
   525	
   526	/** "Opponent controls" is relative to the WATCHER's controller, never the turn player (spec C2-10). */
   527	function watches(state: GameState, trigger: AbilityTrigger, watcher: PlayerId, t: ZoneTransition): boolean {
   528	  if (trigger.kind !== 'observesZoneChange') return false
   529	  if (trigger.to !== 'breakZone') return false   // `from: 'field'` covers both field arrays
   530	  // The moved card's TYPE, from its def — Lightning watches "a FORWARD … put into the Break Zone". Checking the
   531	  // transition's `from` array instead would be the same implicit restriction that made this safe only by accident.
   532	  const code = state.cards[t.card]?.code
   533	  if ((code === undefined ? undefined : state.defs[code])?.type !== trigger.of) return false
   534	  if (trigger.whose === 'self') return t.controller === watcher
   535	  if (trigger.whose === 'opponent') return t.controller === opponentOf(watcher)
   536	  return true
   537	}
   538	
   539	/**
   540	 * Snapshot the watchers of a whole simultaneous batch BEFORE any of it moves (spec C2-4). A Lightning broken in
   541	 * the SAME batch as its own victim must still trigger, and once removal has run its clause is no longer
   542	 * discoverable from the field at all; `Frame.source` already tolerates an off-field source (C1).
   543	 *
   544	 * Order is spec C2-11's total key — (occurrence index, AP/NAP controller, source zone, pre-event field index,
   545	 * ability index, source id) — produced by CONSTRUCTION rather than by sorting: transitions in batch order, then
   546	 * active before non-active player, then forwards before backups, then field-array index, then printed clause
   547	 * order. The final component, source id, can never actually break a tie, because (controller, zone, index)
   548	 * already names exactly one card; it is in the key so the key is total by inspection. Watchers are read from the
   549	 * FIELD ARRAYS only, never `state.cards`, because `determinise` preserves array order and not object-key order.
   550	 *
   551	 * MVP0-SIMPLIFICATION: fixed AP-first FIFO. CR §11.8.7 lets each controller order their OWN simultaneous
   552	 * triggers, with the non-turn player's placed on top of the turn player's. None of this pool's clauses has an
   553	 * outcome-sensitive AP/NAP conflict, so the deviation is unobservable — but it is a deviation.
   554	 */
   555	function collectWatchers(state: GameState, transitions: readonly ZoneTransition[]): WatcherOccurrence[] {
   556	  const out: WatcherOccurrence[] = []
   557	  // Local only, never on GameState. Guards against the SAME occurrence being discovered twice; two DISTINCT
   558	  // transitions matching one watcher stay two occurrences (spec C2-3).
   559	  const seen = new Set<string>()
   560	  const ap = state.turnPlayer
   561	  for (const t of transitions) {
   562	    for (const p of [ap, opponentOf(ap)]) {
   563	      for (const zone of ['forwards', 'backups'] as const) {
   564	        for (const c of state.players[p][zone]) {
   565	          const code = state.cards[c.id]?.code
   566	          for (const ability of (code === undefined ? undefined : state.defs[code])?.abilities ?? []) {
   567	            if (!watches(state, ability.trigger, p, t)) continue
   568	            const key = `${c.id} ${ability.id} ${t.card}`
   569	            if (seen.has(key)) continue
   570	            seen.add(key)
   571	            out.push({ transition: t, source: c.id, controller: p, ability })
   572	          }
   573	        }
   574	      }
   575	    }
   576	  }
   577	  return out
   578	}
   579	
   580	/** Enqueue the snapshotted occurrences AFTER movement, so a frame that looks at the field sees the post-batch one. */
   581	function enqueueZoneTriggers(state: GameState, occurrences: readonly WatcherOccurrence[]): GameState {
   582	  let s = state
   583	  for (const o of occurrences) {
   584	    const t = o.transition
   585	    const event: TriggerEvent = { kind: 'zoneChange', card: t.card, from: 'field', to: 'breakZone', controller: t.controller, owner: t.owner, reason: t.reason }
   586	    s = enqueueTrigger(s, o.source, o.controller, o.ability, event)
   587	  }
   588	  return s
   589	}
   590	/**
   591	 * Dispatch `observesZoneChange` clauses for one batch of field→Break Zone movement.
   592	 *
   593	 * `pre` is the state BEFORE the batch moved — watchers must be read from it, or a watcher that is itself in the
   594	 * batch is already gone (spec C2-4). `post` is the state the frames are queued onto.
   595	 *
   596	 * EVERY field→Break Zone path must call this, not just the §12.4.4/§12.4.5 rule processes. `breakCard` did its own
   597	 * zone move and skipped it, so no observer clause fired on an ability-caused break at all — measured on the
   598	 * shipped gate, ~130 of ~220 ability breaks had a Lightning standing on the watching side, so roughly 40% of the
   599	 * breaks its printed text names were silently missed, with every test, invariant and fuzzer run still green.
   600	 */
   601	export function enqueueZoneChangeTriggers(pre: GameState, post: GameState, transitions: readonly ZoneTransition[]): GameState {
   602	  if (!transitions.length) return post
   603	  return enqueueZoneTriggers(post, collectWatchers(pre, transitions))
   604	}

codex
The first sharp edge is in the chosen preflight design: the code checks only `ability.effects[0]`, and it does not snapshot that candidate set. Cost-trigger frames run before the action frame, so any such trigger that changes target eligibility can make the eventual `Pending` differ from what activation validated. I’m now checking whether current cards can realize that state, versus this being a substrate-level C4 trap.
exec
/bin/zsh -lc "rg -n \"export function defOf|function defOf|checkInvariants|resolution.*pending|hasResolutionWork\" packages/engine/src packages/engine/test | head -200 && nl -ba packages/engine/src/state.ts | sed -n '1,240p' && nl -ba packages/engine/src/invariants.ts | sed -n '1,260p' 2>/dev/null || true" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/engine/test/abilities-engine.test.ts:10:import { checkInvariants } from '../src/invariants.js'
packages/engine/test/abilities-engine.test.ts:51:const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
packages/engine/test/abilities-engine.test.ts:474:        expect(checkInvariants(s), `seed ${seed} step ${i}`).toEqual([])
packages/engine/test/determinise.test.ts:5:import { checkInvariants } from '../src/invariants.js'
packages/engine/test/determinise.test.ts:39:      expect(checkInvariants(det)).toEqual([])
packages/engine/test/determinise.test.ts:67:    expect(checkInvariants(d0)).toEqual([]); expect(d0.pending).toEqual(s0.pending); expect(d0.players[1].deck).toHaveLength(50)
packages/engine/test/determinise.test.ts:77:    expect(d2.attack).toEqual(s2!.attack); expect(checkInvariants(d2)).toEqual([])
packages/engine/test/determinise.test.ts:90:      expect(checkInvariants(det)).toEqual([])
packages/engine/test/determinise.test.ts:116:    expect(checkInvariants(det)).toEqual([])
packages/engine/test/party-damage.test.ts:12:import { checkInvariants } from '../src/invariants.js'
packages/engine/test/party-damage.test.ts:88:const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
packages/engine/src/abilities.ts:241: * consumes, so settlement, `checkInvariants` and the AI's diagnostics that looked at `active`/`queue` alone
packages/engine/src/abilities.ts:244:export function hasResolutionWork(r: Resolution): boolean {
packages/engine/src/apply.ts:3:import { EMPTY_RESOLUTION, hasResolutionWork } from './abilities.js'
packages/engine/src/apply.ts:50:      if (!hasResolutionWork(s.resolution)) break   // settled, and rule processes have run
packages/engine/src/apply.ts:57:  else if (!s.pending && !hasResolutionWork(s.resolution)) s = { ...s, resolution: { ...s.resolution, steps: 0 } }
packages/engine/src/state.ts:59:export function defOf(state: GameState, id: CardId): CardDef {
packages/engine/src/rules.ts:27:  // `checkInvariants` forbids anything staying queued after game over.
packages/engine/src/rules.ts:87: * `dealtDamage` clause like any other (spec C2-8) — would otherwise outlive game over and trip `checkInvariants`.
packages/engine/test/legal-apply.test.ts:5:import { checkInvariants } from '../src/invariants.js'
packages/engine/test/legal-apply.test.ts:85:    expect(checkInvariants(state)).toEqual([])
packages/engine/test/legal-apply.test.ts:100:        expect(checkInvariants(s), `seed ${seed} step ${i}`).toEqual([])
packages/engine/src/invariants.ts:22:export function checkInvariants(state: GameState): string[] {
packages/engine/test/observer-triggers.test.ts:12:import { checkInvariants } from '../src/invariants.js'
packages/engine/test/observer-triggers.test.ts:79:const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
     1	import type { Rng } from './rng.js'
     2	import type { PlayerId, CardDef, Keyword } from './types.js'
     3	import type { FieldFlag, Resolution } from './abilities.js'
     4	
     5	export type CardId = number
     6	export interface CardInstance { id: CardId; code: string; owner: PlayerId }
     7	export type Status = 'active' | 'dull'
     8	export interface FieldCard {
     9	  id: CardId; status: Status; damage: number; enteredTurn: number; attackedThisTurn: boolean
    10	  granted: Keyword[]
    11	  /** Until-end-of-turn power modifier (spec C1-7). Cleared in the End Phase; only `effectivePower` reads it. */
    12	  powerBonus: number
    13	  /** Until-end-of-turn protection `granted` cannot express, e.g. `cannotBeBroken` (spec C1-7). */
    14	  flags: readonly FieldFlag[]
    15	}
    16	export interface PlayerState {
    17	  deck: CardId[]        // index 0 = top
    18	  hand: CardId[]
    19	  forwards: FieldCard[]
    20	  backups: FieldCard[]
    21	  damageZone: CardId[]
    22	  breakZone: CardId[]
    23	  mulliganDecided: boolean
    24	}
    25	export type Phase = 'setup' | 'active' | 'draw' | 'main1' | 'attack' | 'main2' | 'end'
    26	export type AttackStep = 'preparation' | 'declaration' | 'block' | 'damage'
    27	export interface AttackState { step: AttackStep; attackers: CardId[]; blocker: CardId | null }
    28	/** Decisions owed by a specific player that are NOT priority actions (§11.1): setup choices, the defender's step actions in the Attack Phase, and the choices an ability suspends on (spec C1-6). */
    29	export type Pending =
    30	  | { kind: 'chooseFirst'; player: PlayerId }
    31	  | { kind: 'mulligan'; player: PlayerId }
    32	  | { kind: 'discardToHandSize'; player: PlayerId; count: number }
    33	  | { kind: 'declareBlock'; player: PlayerId }          // §10.1.3.1
    34	  | { kind: 'assignPartyDamage'; player: PlayerId }     // §10.1.4.2.1
    35	  /** `candidates` is the exact legal set the executor computed; `apply` re-checks membership rather than trusting it. */
    36	  | { kind: 'chooseTargets'; player: PlayerId; min: number; max: number; candidates: readonly CardId[] }
    37	  /** `labels` are the printed mode wordings, in listed order; an answer is a set of indices into them. */
    38	  | { kind: 'chooseMode'; player: PlayerId; min: number; max: number; labels: readonly string[] }
    39	export interface GameResult { winner: PlayerId | null; reason: string }   // winner null = draw
    40	export interface GameState {
    41	  rng: Rng
    42	  turn: number                 // 1-based; 0 during setup
    43	  turnPlayer: PlayerId
    44	  firstPlayer: PlayerId
    45	  phase: Phase
    46	  attack: AttackState | null   // non-null only while phase === 'attack'
    47	  priority: PlayerId           // CR §11.1 priority holder. MVP0-SIMPLIFICATION: always the turn player (no stack, no passing)
    48	  pending: Pending | null      // a decision owed by `pending.player`; takes precedence over priority for who acts
    49	  /** Ability work the engine owes itself (spec C1-3). `pending` stays the ONE visible decision; this is the queue behind it. */
    50	  resolution: Resolution
    51	  players: [PlayerState, PlayerState]
    52	  cards: Record<CardId, CardInstance>
    53	  defs: Record<string, CardDef>
    54	  result: GameResult | null
    55	}
    56	export const HAND_SIZE_LIMIT = 5      // §9.5.1.2
    57	export const MAX_BACKUPS = 5          // §7.7.4
    58	export const DAMAGE_TO_LOSE = 7       // §3.1.1
    59	export function defOf(state: GameState, id: CardId): CardDef {
    60	  const inst = state.cards[id]
    61	  if (!inst) throw new Error(`unknown card id ${id}`)
    62	  const def = state.defs[inst.code]
    63	  if (!def) throw new Error(`unknown card code ${inst.code}`)
    64	  return def
    65	}
    66	
    67	export function findFieldCard(state: GameState, id: CardId) {
    68	  for (const owner of [0, 1] as const) {
    69	    for (const zone of ['forwards', 'backups'] as const) {
    70	      const card = state.players[owner][zone].find((c) => c.id === id)
    71	      if (card) return { owner, zone, card }
    72	    }
    73	  }
    74	  return null
    75	}
    76	
    77	/**
    78	 * THE single power authority (spec C1-7). Nothing may add `powerBonus` anywhere else — `powerOf` delegates here,
    79	 * and the web board imports it so a pumped Forward displays the power combat actually uses.
    80	 * Power floors at 0: a −9000 debuff on a 3000-power Forward deals no negative damage, it is put into the Break
    81	 * Zone by the §12.4.4 zero-power rule process instead.
    82	 */
    83	export function effectivePower(def: CardDef, card: FieldCard): number {
    84	  return Math.max(0, (def.power ?? 0) + card.powerBonus)
    85	}
    86	
    87	export function powerOf(state: GameState, card: FieldCard): number {
    88	  return effectivePower(defOf(state, card.id), card)
    89	}
    90	
    91	export function keywordsOf(state: GameState, card: FieldCard): Set<Keyword> {
    92	  return new Set([...defOf(state, card.id).keywords, ...card.granted])
    93	}
    94	
    95	export function updatePlayer(state: GameState, p: PlayerId, f: (ps: PlayerState) => PlayerState): GameState {
    96	  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]]
    97	  players[p] = f(state.players[p])
    98	  return { ...state, players }
    99	}
     1	import type { Frame } from './abilities.js'
     2	import { FIELD_FLAGS, MAX_RESOLUTION_STEPS } from './abilities.js'
     3	import type { FieldCard, GameState } from './state.js'
     4	import { MAX_BACKUPS } from './state.js'
     5	import { KEYWORDS } from './types.js'
     6	
     7	function checkFieldCard(problems: string[], where: string, c: FieldCard): void {
     8	  if (c.damage < 0) problems.push(`card ${c.id} has negative damage`)
     9	  if (!Number.isInteger(c.powerBonus) || !Number.isFinite(c.powerBonus)) problems.push(`card ${c.id} in ${where} has non-integral powerBonus ${c.powerBonus}`)
    10	  for (const f of c.flags) if (!FIELD_FLAGS.includes(f)) problems.push(`card ${c.id} has unknown flag ${String(f)}`)
    11	  if (new Set(c.flags).size !== c.flags.length) problems.push(`card ${c.id} has duplicate flags`)
    12	  for (const k of c.granted) if (!KEYWORDS.includes(k)) problems.push(`card ${c.id} has unknown granted keyword ${String(k)}`)
    13	}
    14	
    15	function checkFrame(problems: string[], where: string, f: Frame, state: GameState): void {
    16	  if (!state.cards[f.source]) problems.push(`${where} frame ${f.abilityId} has unknown source ${f.source}`)
    17	  if (f.path.some((i) => !Number.isInteger(i) || i < 0)) problems.push(`${where} frame ${f.abilityId} has a malformed program counter`)
    18	  if (new Set(f.chosen).size !== f.chosen.length) problems.push(`${where} frame ${f.abilityId} chose a duplicate target`)
    19	  if (new Set(f.modes).size !== f.modes.length) problems.push(`${where} frame ${f.abilityId} chose a duplicate mode`)
    20	}
    21	
    22	export function checkInvariants(state: GameState): string[] {
    23	  const problems: string[] = []
    24	  const seen = new Map<number, string>()
    25	  const note = (id: number, where: string) => { const prev = seen.get(id); if (prev) problems.push(`card ${id} in both ${prev} and ${where}`); seen.set(id, where) }
    26	  for (const p of [0, 1] as const) {
    27	    const ps = state.players[p]
    28	    ps.deck.forEach((id) => note(id, `P${p} deck`))
    29	    ps.hand.forEach((id) => note(id, `P${p} hand`))
    30	    ps.damageZone.forEach((id) => note(id, `P${p} damage`))
    31	    ps.breakZone.forEach((id) => note(id, `P${p} break`))
    32	    for (const zone of ['forwards', 'backups'] as const) {
    33	      for (const c of ps[zone]) {
    34	        note(c.id, `P${p} ${zone}`)
    35	        checkFieldCard(problems, `P${p} ${zone}`, c)
    36	        const inst = state.cards[c.id]
    37	        if (!inst || !state.defs[inst.code]) problems.push(`field card ${c.id} has no definition`)
    38	      }
    39	    }
    40	    if (ps.backups.length > MAX_BACKUPS) problems.push(`P${p} controls ${ps.backups.length} backups`)
    41	  }
    42	  const all = Object.keys(state.cards).map(Number)
    43	  if (seen.size !== all.length) problems.push(`${all.length} card instances but ${seen.size} placed in zones`)
    44	  for (const id of all) if (!seen.has(id)) problems.push(`card ${id} is in no zone`)
    45	  if ((state.attack !== null) !== (state.phase === 'attack')) problems.push(`attack state ${state.attack ? 'present' : 'absent'} in phase ${state.phase}`)
    46	  if (state.result && state.pending) problems.push('pending decision after game over')
    47	
    48	  // --- the resolution agenda (spec C1-A7) ---
    49	  const r = state.resolution
    50	  if (!Number.isInteger(r.steps) || r.steps < 0) problems.push(`resolution.steps is ${r.steps}`)
    51	  if (r.steps > MAX_RESOLUTION_STEPS) problems.push(`resolution.steps ${r.steps} exceeds the ${MAX_RESOLUTION_STEPS} budget`)
    52	  if (state.result && (r.active || r.queue.length || r.continuation)) problems.push('resolution work queued after game over')
    53	  if (r.active) checkFrame(problems, 'active', r.active, state)
    54	  for (const f of r.queue) checkFrame(problems, 'queued', f, state)
    55	  // An ability pending and the active frame are two halves of one suspension — neither may exist alone.
    56	  const abilityPending = state.pending?.kind === 'chooseTargets' || state.pending?.kind === 'chooseMode'
    57	  if (abilityPending && !r.active) problems.push(`pending ${state.pending?.kind} with no active frame`)
    58	  if (r.active && !abilityPending) problems.push(`active frame ${r.active.abilityId} with no ability pending`)
    59	  if (abilityPending && r.active && state.pending && state.pending.player !== r.active.controller) {
    60	    problems.push(`pending ${state.pending.kind} is owed by P${state.pending.player} but the frame is controlled by P${r.active.controller}`)
    61	  }
    62	  if (state.pending?.kind === 'chooseTargets') {
    63	    const { min, max, candidates } = state.pending
    64	    if (new Set(candidates).size !== candidates.length) problems.push('chooseTargets candidates contain a duplicate')
    65	    if (!(min <= max && max <= candidates.length)) problems.push(`chooseTargets bounds ${min}..${max} over ${candidates.length} candidates`)
    66	    for (const id of candidates) if (!state.cards[id]) problems.push(`chooseTargets candidate ${id} is not a card`)
    67	  }
    68	  if (state.pending?.kind === 'chooseMode') {
    69	    const { min, max, labels } = state.pending
    70	    if (!(min <= max && max <= labels.length)) problems.push(`chooseMode bounds ${min}..${max} over ${labels.length} modes`)
    71	  }
    72	  return problems
    73	}

exec
/bin/zsh -lc "nl -ba packages/ai/src/payment.ts && nl -ba packages/ai/src/candidates.ts && nl -ba packages/ai/src/evaluate.ts && nl -ba packages/ai/src/ismcts/keys.ts | sed -n '1,260p'; nl -ba packages/ai/src/ismcts/keys.ts | sed -n '261,560p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { canPay, castRequirement, defOf, generateCp, type CardId, type CpRequirement, type Element, type GameState, type Payment, type PlayerId } from '@fftcg/engine'
     2	import { cardValue } from './cardValue.js'
     3	
     4	interface Source { kind: 'backup' | 'discard'; id: CardId; elements: Element[]; cp: number; cost: number }
     5	
     6	/**
     7	 * Find the least valuable way to cover every required element with one source each (cheapest by `Source.cost` —
     8	 * see R1 below — not by CP generated), via bounded backtracking (required
     9	 * elements ≤ 8 per CardDef, sources ≤ ~12 in practice — trivially small to search exhaustively). A single greedy
    10	 * pass — even scarcest-element-first — can still strand a later element: spending a flexible source on an element
    11	 * a less flexible (but pricier) source could also have covered, only to find nothing left for the element only
    12	 * the flexible source could pay (Codex: sources {earth}(expensive), {earth,lightning}(cheap), {lightning,fire} —
    13	 * greedy spends the cheap dual source on earth, then has nothing for lightning once the fire-only source is
    14	 * spent on fire). Backtracking explores every source-to-element assignment (not just the first that fits) and
    15	 * keeps the cheapest complete one, so it finds a covering assignment whenever one exists.
    16	 */
    17	function assignRequiredElements(elements: readonly Element[], sources: Source[], canSupply: (s: Source, e: Element) => boolean): Map<Element, Source> | null {
    18	  // Processing scarcest elements first prunes the search fastest but doesn't change correctness — every branch
    19	  // below tries every remaining candidate for the current element and recurses, so it finds a covering
    20	  // assignment (the cheapest one) whenever one exists, regardless of element order.
    21	  const order = [...elements].sort((a, b) => sources.filter((s) => canSupply(s, a)).length - sources.filter((s) => canSupply(s, b)).length)
    22	  const used = new Set<Source>()
    23	  const rec = (i: number): { assignment: Map<Element, Source>; cost: number } | null => {
    24	    if (i === order.length) return { assignment: new Map(), cost: 0 }
    25	    const e = order[i] as Element
    26	    let best: { assignment: Map<Element, Source>; cost: number } | null = null
    27	    for (const s of sources) {
    28	      if (used.has(s) || !canSupply(s, e)) continue
    29	      used.add(s)
    30	      const rest = rec(i + 1)
    31	      used.delete(s)
    32	      if (!rest) continue
    33	      // R1: minimise `Source.cost` (what spending the source is WORTH giving up — 1 for a backup, 2 + cardValue
    34	      // for a discard), not `Source.cp` (how much CP it generates). Every discard generates 2 CP, so ranking by
    35	      // `cp` cannot separate two discards and silently falls back to hand order — which threw away an 8000-power
    36	      // forward where a cost-1 summon would do. `cost` also still prefers backups (1) over any discard (>= 2),
    37	      // which is why the pre-backtracking greedy pass sorted by it.
    38	      const cost = s.cost + rest.cost
    39	      if (!best || cost < best.cost) {
    40	        const assignment = new Map(rest.assignment)
    41	        assignment.set(e, s)
    42	        best = { assignment, cost }
    43	      }
    44	    }
    45	    return best
    46	  }
    47	  const result = rec(0)
    48	  return result ? result.assignment : null
    49	}
    50	
    51	export function preferredPayment(state: GameState, player: PlayerId, card: CardId): Payment | null {
    52	  return preferredPaymentFor(state, player, castRequirement(state, card))
    53	}
    54	
    55	/**
    56	 * As `preferredPayment`, for any requirement — an activated ability's cost as readily as a card's printed one
    57	 * (spec C3-4). The value-minimising logic is the whole point of using this over `enumeratePaymentsFor`: it is
    58	 * what stops the AI discarding an 8000-power Forward to pay for a draw.
    59	 */
    60	export function preferredPaymentFor(state: GameState, player: PlayerId, req: CpRequirement): Payment | null {
    61	  const card = req.excluded
    62	  if (req.amount === 0) return { dullBackups: [], discards: [] }
    63	  const ps = state.players[player]
    64	  const sources: Source[] = []
    65	  for (const b of ps.backups) {
    66	    if (b.status !== 'active' || card.includes(b.id)) continue
    67	    sources.push({ kind: 'backup', id: b.id, elements: defOf(state, b.id).elements, cp: 1, cost: 1 })
    68	  }
    69	  for (const id of ps.hand) {
    70	    if (card.includes(id)) continue
    71	    const d = defOf(state, id)
    72	    if (d.elements.includes('light') || d.elements.includes('dark')) continue
    73	    sources.push({ kind: 'discard', id, elements: d.elements, cp: 2, cost: 2 + cardValue(d) })
    74	  }
    75	  const chosen = new Set<Source>()
    76	  const declared = new Map<CardId, Element>()
    77	  let total = 0
    78	  const take = (s: Source, element: Element) => { chosen.add(s); total += s.cp; if (s.kind === 'discard') declared.set(s.id, element) }
    79	  const canSupply = (s: Source, e: Element) => (s.kind === 'backup' ? s.elements[0] === e : s.elements.includes(e))   // backups produce elements[0] only (cp.ts)
    80	
    81	  // §11.2.2.1 / §11.2.1.1: at least one CP of each required element (requiredElements exempts pure Light/Dark).
    82	  const elements = req.requiredElements
    83	  const assignment = assignRequiredElements(elements, sources, canSupply)
    84	  if (elements.length && !assignment) return null
    85	  if (assignment) for (const [e, s] of assignment) take(s, e)
    86	
    87	  for (const s of [...sources].sort((a, b) => a.cost - b.cost)) { if (total >= req.amount) break; if (!chosen.has(s)) take(s, s.elements[0] as Element) }
    88	  if (total < req.amount) return null
    89	
    90	  // R5: emit sources in the engine's own order — `enumeratePayments` lists dullBackups in field order and
    91	  // discards in hand order, so a payment built in *selection* order is the same payment but a different object,
    92	  // and any caller matching preferredPayment's result against legalCommands by value would spuriously miss it
    93	  // (which is most of them: the UI collapses a card's many legal payments down to this one). Canonical here,
    94	  // not at every call site.
    95	  const backupOrder = new Map(ps.backups.map((b, i) => [b.id, i]))
    96	  const handOrder = new Map(ps.hand.map((id, i) => [id, i]))
    97	  const build = (from: Iterable<Source>): Payment => {
    98	    const list = [...from]
    99	    return {
   100	      dullBackups: list.filter((s) => s.kind === 'backup').map((s) => s.id).sort((a, b) => (backupOrder.get(a) ?? 0) - (backupOrder.get(b) ?? 0)),
   101	      discards: list.filter((s) => s.kind === 'discard').map((s) => ({ card: s.id, element: declared.get(s.id) as Element }))
   102	        .sort((a, b) => (handOrder.get(a.card) ?? 0) - (handOrder.get(b.card) ?? 0)),
   103	    }
   104	  }
   105	  const pays = (from: Iterable<Source>): boolean => canPay(req.amount, elements, generateCp(state, player, build(from), card))
   106	
   107	  // R5: the two phases above are each greedy in isolation, so together they can over-spend — the required-element
   108	  // phase takes the cheapest source for the element (often a 1 CP backup), then the top-up phase adds a 2 CP
   109	  // discard to reach the cost, when that discard alone would have paid exactly. That matters twice over:
   110	  // `enumeratePayments` emits only MINIMAL payments, so a non-minimal result is not in `legalCommands` at all
   111	  // (measured: 40.2% of results over real games), which makes it unusable as a move for the UI and wasteful for
   112	  // the AI. Drop the most valuable redundant source until none can go, which is exactly enumeratePayments'
   113	  // minimality condition: removing any single remaining source must break the payment.
   114	  for (;;) {
   115	    const droppable = [...chosen].filter((s) => pays([...chosen].filter((o) => o !== s))).sort((a, b) => b.cost - a.cost)
   116	    const worst = droppable[0]
   117	    if (!worst) break
   118	    chosen.delete(worst)
   119	  }
   120	
   121	  const payment = build(chosen)
   122	  return pays(chosen) ? payment : null
   123	}
     1	import { abilityCpRequirement, abilityOf, actingPlayer, activationCheck, attackCheck, castCheck, defOf, effectivePower, findFieldCard, keywordsOf, legalAttackSets, legalBlockers, legalCommands, legalPartyDamageAssignments, targetCandidates, type CardId, type Command, type Effect, type GameState, type Pending, type PlayerId } from '@fftcg/engine'
     2	import { cardValue } from './cardValue.js'
     3	import { hasteUnlock, protectionValue } from './evaluate.js'
     4	import { preferredPayment, preferredPaymentFor } from './payment.js'
     5	
     6	const ATTACK_SET_EXPLOSION_THRESHOLD = 6
     7	
     8	/**
     9	 * `legalAttackSets` enumerates every subset of eligible attackers (2^n), which is fine for a handful of forwards
    10	 * but explodes well before a 50-card deck's forward count is even reachable in practice. Above the threshold, fall
    11	 * back to a bounded set of candidates (C5): every single attacker, every legal PAIR of attackers, and — per
    12	 * element — the full party of every eligible forward sharing that element, deduplicated by sorted attacker-id
    13	 * signature so e.g. two same-element pairs that happen to coincide, or a pair that equals a 2-forward "full
    14	 * party", are only emitted once. This covers singles, small trading parties, and "attack with everything of one
    15	 * element" without ever enumerating all 2^n combinations; every intermediate size above 2 is still not
    16	 * considered — a deliberate bound, not full coverage.
    17	 */
    18	function boundedAttackSets(state: GameState, player: PlayerId): CardId[][] {
    19	  const eligible = state.players[player].forwards.map((c) => c.id).filter((id) => attackCheck(state, player, [id]) === null)
    20	  if (eligible.length <= ATTACK_SET_EXPLOSION_THRESHOLD) return legalAttackSets(state, player)
    21	  const seen = new Set<string>()
    22	  const out: CardId[][] = []
    23	  const add = (set: CardId[]) => {
    24	    const key = [...set].sort((a, b) => a - b).join(',')
    25	    if (seen.has(key)) return
    26	    seen.add(key)
    27	    out.push(set)
    28	  }
    29	  for (const id of eligible) add([id])
    30	  for (let i = 0; i < eligible.length; i++) {
    31	    for (let j = i + 1; j < eligible.length; j++) {
    32	      const pair = [eligible[i] as CardId, eligible[j] as CardId]
    33	      if (attackCheck(state, player, pair) === null) add(pair)
    34	    }
    35	  }
    36	  const byElement = new Map<string, CardId[]>()
    37	  for (const id of eligible) for (const e of defOf(state, id).elements) byElement.set(e, [...(byElement.get(e) ?? []), id])
    38	  for (const ids of byElement.values()) {
    39	    if (ids.length < 2) continue
    40	    if (attackCheck(state, player, ids) === null) add(ids)
    41	  }
    42	  return out
    43	}
    44	
    45	// ---------------------------------------------------------------------------
    46	// The one-ply ability-target policy (spec C1, "The AI")
    47	// ---------------------------------------------------------------------------
    48	
    49	/**
    50	 * `legalCommands` enumerates Σ C(N, k) answers for a `chooseTargets`/`chooseMode` pending — ~190 commands for
    51	 * "up to 2" over both fields. Scoring all of them with a rollout each is the whole decision budget spent on one
    52	 * ability. Instead the answers are RANKED by a cheap one-ply policy and only a handful of them are offered.
    53	 */
    54	const CHOICE_CANDIDATE_CAP = 6
    55	
    56	/**
    57	 * The `Effect` the active frame is suspended at. `resolve.ts` keeps its own `effectAt` private — it is the
    58	 * authority `apply` re-validates against — so this is the AI's read-only copy of the same walk. Every caller
    59	 * falls back to `legalCommands` when it returns null: being wrong here can only cost play strength, never
    60	 * legality, because the engine re-derives the candidates itself.
    61	 */
    62	function effectAt(effects: readonly Effect[], path: readonly number[], modes: readonly number[], depth: number): Effect | null {
    63	  const eff = effects[path[depth] ?? -1]
    64	  if (!eff) return null
    65	  if (depth === path.length - 1) return eff
    66	  if (eff.kind === 'chooseTargets') return effectAt(eff.then, path, modes, depth + 1)
    67	  if (eff.kind === 'chooseModes') {
    68	    const k = path[depth + 1]
    69	    const mode = k === undefined ? undefined : eff.modes[modes[k] ?? -1]
    70	    return mode ? effectAt(mode.effects, path, modes, depth + 2) : null
    71	  }
    72	  return null
    73	}
    74	
    75	function suspendedEffect(state: GameState): Effect | null {
    76	  const frame = state.resolution.active
    77	  if (!frame) return null
    78	  const ability = abilityOf(state, frame)
    79	  return ability ? effectAt(ability.effects, frame.path, frame.modes, 0) : null
    80	}
    81	
    82	/** The side a target belongs to: its controller on the field, its owner in a Break Zone (§7.10). */
    83	function sideOf(state: GameState, id: CardId): PlayerId {
    84	  return findFieldCard(state, id)?.owner ?? state.cards[id]?.owner ?? 0
    85	}
    86	
    87	/**
    88	 * Does `source`'s own printed text break whatever it damages? Luso (`27-125S:damages-forward`) is the C2 case:
    89	 * a `dealtDamage` clause whose `onSubject` breaks the damaged Forward, so the break follows from ANY damage,
    90	 * however little power it leaves standing. Read off the AST — the same `state.defs` channel `determinise`
    91	 * carries — so this is a statement about the clause shape, never about a card code.
    92	 *
    93	 * Without it the policy prices Luso's "Deal it 3000 damage" mode by §12.4.5 alone and ranks the 3000-power
    94	 * Forward it can kill outright ABOVE the 9000-power one it also kills via the cascade — the head of the
    95	 * candidate list, and therefore the answer a budget-starved `greedyStep` plays.
    96	 */
    97	function breaksWhatItDamages(state: GameState, source: CardId): boolean {
    98	  const code = state.cards[source]?.code
    99	  for (const a of (code === undefined ? undefined : state.defs[code])?.abilities ?? []) {
   100	    if (a.trigger.kind !== 'dealtDamage' || a.trigger.to !== 'forward') continue
   101	    if (a.effects.some((e) => e.kind === 'onSubject' && e.do.some((d) => d.kind === 'breakCard'))) return true
   102	  }
   103	  return false
   104	}
   105	
   106	/**
   107	 * How much better off the TARGET's own side is once `effects` resolve on it, in `evaluate`-ish units
   108	 * (power/1000 and `cardValue`); harmful effects are negative. `targetScore` flips the sign for an opponent's
   109	 * card, which is what turns one number into "how much I want to pick this".
   110	 *
   111	 * `source` is the card whose ability this is: the value of an effect can depend on the source's OTHER clauses
   112	 * (`breaksWhatItDamages`), which is new in C2 — before it, every clause was self-contained.
   113	 *
   114	 * Only the effects directly under the chooser are priced. A nested chooser's value is not knowable one ply out
   115	 * and every C1 clause is flat, so unknown shapes contribute 0 rather than a guess.
   116	 */
   117	function targetDelta(state: GameState, source: CardId, effects: readonly Effect[], id: CardId): number {
   118	  const loc = findFieldCard(state, id)
   119	  const def = defOf(state, id)
   120	  const power = loc ? effectivePower(def, loc.card) : (def.power ?? 0)
   121	  let d = 0
   122	  for (const eff of effects) {
   123	    switch (eff.kind) {
   124	      case 'dull':
   125	        // A dull Forward can neither attack (§10.1.2.1.1) nor block (§10.1.3.1.1); dulling an already-dull one
   126	        // is a no-op, which is why an active target must OUTRANK a dull one rather than tie it.
   127	        if (loc && loc.card.status === 'active') d -= power / 1000 + 1
   128	        break
   129	      case 'damage': {
   130	        if (!loc || loc.zone !== 'forwards') break   // only Forwards carry damage
   131	        // §12.4.5: damage ≥ power breaks. Damage that actually breaks is worth the whole card; damage that does
   132	        // not is worth only the exposure it leaves behind. C2: a source that breaks what it damages (Luso) kills
   133	        // the target whatever its power — `cannotBeBroken` stops both routes (§12.4.5 and `breakCard` alike).
   134	        const lethal = power >= 1000 && loc.card.damage + eff.amount >= power
   135	        const breaks = (lethal || breaksWhatItDamages(state, source)) && !loc.card.flags.includes('cannotBeBroken')
   136	        const kill = cardValue(def) + power / 1000
   137	        if (breaks) { d -= kill; break }
   138	        // Non-lethal damage was priced `eff.amount / 1000` — a constant, independent of the target and of the
   139	        // damage already on it. That let a chip OUTRANK a kill: 5000 into a 1000-power Forward scored -5 while
   140	        // breaking it scored only -2.5, so the policy offered the survivor first and a budget-starved greedyStep
   141	        // (which scores only the first candidate) played it. Price it instead as the fraction of the target it
   142	        // actually removes, times what killing it would be worth — always strictly less than the kill, and
   143	        // monotone in both the damage dealt and the target's value.
   144	        // Denominator is FULL power, not remaining life: capping at remaining would score a hit on a
   145	        // `cannotBeBroken` Forward as a whole kill's worth, when that card cannot die at all this turn.
   146	        // The 0.25 factor is deliberately conservative because `evaluate` has no per-card damage term —
   147	        // chip damage is worth literally 0 to the search, so a policy that priced it richly would chase
   148	        // value the search then fails to confirm. It keeps a kill ahead of a chip across this pool's whole
   149	        // power range while still preferring a bigger dent to a smaller one.
   150	        const dealt = Math.min(eff.amount, Math.max(0, power - loc.card.damage))
   151	        d -= power > 0 ? (dealt / power) * kill * 0.25 : 0
   152	        break
   153	      }
   154	      case 'breakCard':
   155	        if (loc && !loc.card.flags.includes('cannotBeBroken')) d -= cardValue(def) + power / 1000
   156	        break
   157	      case 'moveToHand':
   158	        // From the field this is removal (that side loses a body and keeps the card); from the Break Zone it is
   159	        // retrieval — pure gain, priced by the card itself. `cardValue` is what makes C2-9's "Character"
   160	        // retrieval (Forward, Backup OR Monster in one candidate list) rank across types rather than within one.
   161	        d += loc ? -(power / 1000) : cardValue(def)
   162	        break
   163	      case 'addPower':
   164	        if (loc) d += eff.amount / 1000
   165	        break
   166	      case 'grantKeyword':
   167	        // Priced by the SAME helpers `evaluate` uses, so the value the policy targets is the value the search
   168	        // then sees. Granting a keyword the card already has is a no-op — score it as one.
   169	        if (!loc || keywordsOf(state, loc.card).has(eff.keyword)) break
   170	        d += eff.keyword === 'haste' ? hasteUnlock(state, loc.owner, loc.card, loc.zone === 'forwards') : 0.5
   171	        break
   172	      case 'grantFlag':
   173	        if (loc && eff.flag === 'cannotBeBroken' && !loc.card.flags.includes('cannotBeBroken')) {
   174	          d += protectionValue(state, loc.card, loc.zone === 'forwards')
   175	        }
   176	        break
   177	      // chooseTargets / chooseModes / forEach: nested, deliberately unpriced. `onSubject` (C2-5) belongs here
   178	      // too but for a different reason — it acts on the TRIGGER EVENT's card, never on the one being chosen, so
   179	      // its value is independent of this ranking whatever it contains.
   180	      default: break
   181	    }
   182	  }
   183	  return d
   184	}
   185	
   186	const targetScore = (state: GameState, me: PlayerId, source: CardId, effects: readonly Effect[], id: CardId): number =>
   187	  (sideOf(state, id) === me ? 1 : -1) * targetDelta(state, source, effects, id)
   188	
   189	/** Descending score, ties broken by ascending id/index — a total order, so ranking is deterministic. */
   190	function rankBy(items: readonly number[], score: (x: number) => number): { ranked: number[]; scores: number[] } {
   191	  const scored = items.map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s || a.x - b.x)
   192	  return { ranked: scored.map((e) => e.x), scores: scored.map((e) => e.s) }
   193	}
   194	
   195	/** Best k in `min..max` by prefix sum of an already-descending score list, ties to the SMALLER k. */
   196	function bestSize(scores: readonly number[], min: number, max: number): number {
   197	  let best = min, bestSum = -Infinity, sum = 0
   198	  for (let k = 0; k <= max; k++) {
   199	    if (k > 0) sum += scores[k - 1] ?? 0
   200	    if (k >= min && sum > bestSum) { best = k; bestSum = sum }
   201	  }
   202	  return best
   203	}
   204	
   205	/**
   206	 * The bounded, deterministic answer set for a `min..max` choice over `ranked` (already best-first). The policy's
   207	 * own pick comes FIRST — a budget-starved `greedyStep` scores only the first candidate, so the first candidate
   208	 * has to be the answer the policy actually wants, not the smallest one. Then the other sizes, then a couple of
   209	 * swap-variants at the best size so a well-resourced search can overrule a wrong ranking. Never enumerates
   210	 * C(N, k).
   211	 */
   212	function policyChoices(ranked: readonly number[], scores: readonly number[], min: number, max: number): number[][] {
   213	  const top = bestSize(scores, min, max)
   214	  const out: number[][] = []
   215	  const seen = new Set<string>()
   216	  const push = (xs: number[]) => {
   217	    const key = [...xs].sort((a, b) => a - b).join(',')
   218	    if (seen.has(key) || out.length >= CHOICE_CANDIDATE_CAP) return
   219	    seen.add(key)
   220	    out.push(xs)
   221	  }
   222	  push(ranked.slice(0, top))
   223	  for (let k = min; k <= max; k++) push(ranked.slice(0, k))
   224	  for (let j = top; top >= 1 && j < ranked.length; j++) push([...ranked.slice(0, top - 1), ranked[j] as number])
   225	  return out
   226	}
   227	
   228	/**
   229	 * One-ply value of running `effects` for `me` — the same units as `targetDelta`, used to rank the MODES of a
   230	 * `chooseModes` (they are only distinguishable by what their branches would do). A chooser inside a mode is
   231	 * priced as the policy's own best answer to it.
   232	 */
   233	function effectsValue(state: GameState, me: PlayerId, source: CardId, controller: PlayerId, effects: readonly Effect[]): number {
   234	  let v = 0
   235	  for (const eff of effects) {
   236	    if (eff.kind === 'chooseTargets') {
   237	      const { scores } = rankBy(targetCandidates(state, source, controller, eff.from), (id) => targetScore(state, me, source, eff.then, id))
   238	      const max = Math.min(eff.max, scores.length)
   239	      if (eff.min > scores.length) continue   // cannot legally resolve: the executor no-ops it
   240	      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
   241	    } else if (eff.kind === 'forEach') {
   242	      for (const id of targetCandidates(state, source, controller, eff.from)) v += targetScore(state, me, source, eff.do, id)
   243	    } else if (eff.kind === 'chooseModes') {
   244	      const { scores } = rankBy(eff.modes.map((_, i) => i), (i) => effectsValue(state, me, source, controller, eff.modes[i]?.effects ?? []))
   245	      const max = Math.min(eff.max, scores.length)
   246	      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
   247	    }
   248	    // Everything else needs a `chosen` binding it does not have at this level, so it contributes nothing.
   249	  }
   250	  return v
   251	}
   252	
   253	function chooseTargetsCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseTargets' }>): Command[] {
   254	  const frame = state.resolution.active
   255	  const node = suspendedEffect(state)
   256	  if (!frame || node?.kind !== 'chooseTargets') return legalCommands(state, player).filter((c) => c.type === 'chooseTargets')
   257	  const { ranked, scores } = rankBy(pending.candidates, (id) => targetScore(state, player, frame.source, node.then, id))
   258	  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
   259	  // Sorted so the emitted command is structurally identical to the one `legalCommands` lists for the same set.
   260	  // Target order is semantically irrelevant (`applyChooseTargets` is order-insensitive), but any consumer that
   261	  // matches an AI command against `legalCommands` by deep equality — the web's `sameCommand` is the obvious one —
   262	  // would otherwise fail to find a perfectly legal answer, because the policy emits best-first.
   263	  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
   264	}
   265	
   266	function chooseModeCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseMode' }>): Command[] {
   267	  const frame = state.resolution.active
   268	  const node = suspendedEffect(state)
   269	  if (!frame || node?.kind !== 'chooseModes') return legalCommands(state, player).filter((c) => c.type === 'chooseMode')
   270	  const { ranked, scores } = rankBy(node.modes.map((_, i) => i), (i) => effectsValue(state, player, frame.source, frame.controller, node.modes[i]?.effects ?? []))
   271	  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
   272	  return picks.map((modes) => ({ type: 'chooseMode', player, modes: [...modes].sort((a, b) => a - b) }))
   273	}
   274	
   275	export function candidateCommands(state: GameState, player: PlayerId): Command[] {
   276	  if (state.result || actingPlayer(state) !== player) return []
   277	  const out: Command[] = []
   278	  const pending = state.pending
   279	  if (pending) {
   280	    switch (pending.kind) {
   281	      case 'chooseFirst': return [{ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }]
   282	      case 'mulligan': return [{ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }]
   283	      case 'discardToHandSize': {
   284	        const byValue = [...state.players[player].hand].sort((a, b) => cardValue(defOf(state, a)) - cardValue(defOf(state, b)))
   285	        return [{ type: 'discardToHandSize', player, cards: byValue.slice(0, pending.count) }]
   286	      }
   287	      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
   288	      case 'assignPartyDamage': return legalPartyDamageAssignments(state).map((assignments) => ({ type: 'assignPartyDamage' as const, player, assignments }))
   289	      case 'chooseTargets': return chooseTargetsCandidates(state, player, pending)
   290	      case 'chooseMode': return chooseModeCandidates(state, player, pending)
   291	      // W3: exhaustive — a new Pending kind must fail to compile here rather than silently falling through to phase generation.
   292	      default: { const _exhaustive: never = pending; return _exhaustive }
   293	    }
   294	  }
   295	  if (state.phase === 'main1' || state.phase === 'main2') {
   296	    for (const card of state.players[player].hand) {
   297	      if (castCheck(state, player, card) !== null) continue
   298	      const payment = preferredPayment(state, player, card)
   299	      if (!payment) continue
   300	      out.push({ type: defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter', player, card, payment })
   301	    }
   302	    // C3: activations must be emitted HERE, not merely be legal. This list — not `legalCommands` — is what
   303	    // both agents search, so a command that exists only in `legalCommands` is invisible to the AI, which
   304	    // would have shipped an opponent that never used an ability it was holding.
   305	    out.push(...activationCandidates(state, player))
   306	    out.push({ type: 'pass', player })
   307	  } else if (state.phase === 'attack' && state.attack?.step === 'declaration') {
   308	    for (const attackers of boundedAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
   309	    out.push({ type: 'pass', player })
   310	  }
   311	  return out
   312	}
   313	
   314	/**
   315	 * One activation per (source card, clause), each with the single payment `preferredPaymentFor` likes best.
   316	 *
   317	 * One rather than all: `legalCommands` enumerates every minimal payment, and offering the search a dozen
   318	 * spellings of the same move would multiply the branching factor for a choice that is nearly always
   319	 * value-dominated. This mirrors what casting already does a few lines above.
   320	 */
   321	function activationCandidates(state: GameState, player: PlayerId): Command[] {
   322	  const out: Command[] = []
   323	  const ps = state.players[player]
   324	  const sources = [...ps.hand, ...ps.breakZone, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id)]
   325	  for (const source of sources) {
   326	    for (const ability of defOf(state, source).abilities ?? []) {
   327	      if (ability.trigger.kind !== 'activated') continue
   328	      if (activationCheck(state, player, source, ability.id) !== null) continue
   329	      const payment = preferredPaymentFor(state, player, abilityCpRequirement(source, ability.trigger.cost))
   330	      if (!payment) continue
   331	      out.push({ type: 'activateAbility', player, source, abilityId: ability.id, payment })
   332	    }
   333	  }
   334	  return out
   335	}
     1	import { DAMAGE_TO_LOSE, HAND_SIZE_LIMIT, MAX_BACKUPS, defOf, keywordsOf, opponentOf, powerOf, type FieldCard, type GameState, type PlayerId } from '@fftcg/engine'
     2	import { cardValue } from './cardValue.js'
     3	
     4	export interface Weights {
     5	  damage: number
     6	  forwardPower: number
     7	  forwardPresence: number
     8	  dullFactor: number
     9	  backup: number
    10	  hand: number
    11	  handQuality: number
    12	  deck: number
    13	  threat: number
    14	  terminal: number
    15	  /** Rung C1. All three are worth exactly zero on a board with no granted keywords and no flags. */
    16	  haste: number
    17	  brave: number
    18	  protection: number
    19	  /**
    20	   * Rung C3. The rate at which `powerBonus` — power that EXPIRES at end of turn — counts toward material,
    21	   * against `forwardPower` for power the card actually has.
    22	   *
    23	   * Without this the two are identical, and the arithmetic worked out exactly wrong. Losing an active
    24	   * 2000-power Undead Princess costs `2×1.2 + 4 + 2×0.8 = 8.0`; giving another Forward +4000 gains
    25	   * `4×1.2 + 4×0.8 = 8.0`. A dead heat — and `greedyStep` keeps the EARLIER command on a tie, so it would
    26	   * sacrifice a permanent body for a bonus that vanishes at end of turn, whether or not anything came of it.
    27	   * The bonus still counts fully toward `threat`, because a temporary bonus really does swing combat THIS
    28	   * turn; what it must not do is masquerade as a permanent gain.
    29	   */
    30	  temporaryPower: number
    31	}
    32	
    33	export const DEFAULT_WEIGHTS: Weights = {
    34	  damage: 30,
    35	  forwardPower: 1.2,
    36	  forwardPresence: 4,
    37	  dullFactor: 0.6,
    38	  backup: 5,
    39	  hand: 2,
    40	  handQuality: 0.5,
    41	  deck: 0.1,
    42	  threat: 0.8,
    43	  terminal: 100_000,
    44	  haste: 1.0,
    45	  brave: 0.6,
    46	  protection: 0.5,
    47	  temporaryPower: 0.4,
    48	}
    49	
    50	/**
    51	 * What Haste (§15.2.3) is worth on this card RIGHT NOW, in power/1000 units and ignoring whether the card
    52	 * already has it: exactly what it unlocks — an attack this turn by a Forward that entered this turn. On a
    53	 * Forward that is dull, has already attacked, is not this turn's, or was already attack-eligible (§10.1.2.1.1),
    54	 * Haste changes nothing and this is 0, so it can never outrank a real option (spec C1, "The AI").
    55	 *
    56	 * Exported because `evaluate` prices Haste a card HAS and the target policy prices Haste a card WOULD BE GIVEN;
    57	 * they must agree, or the AI picks a target whose value it then fails to see.
    58	 */
    59	export function hasteUnlock(state: GameState, controller: PlayerId, c: FieldCard, isForward: boolean): number {
    60	  if (!isForward || state.turnPlayer !== controller) return 0   // Backups never attack; on the opponent's turn it is eligible next turn regardless
    61	  if (c.status !== 'active' || c.attackedThisTurn || c.enteredTurn < state.turn) return 0
    62	  return 1 + powerOf(state, c) / 1000
    63	}
    64	
    65	/**
    66	 * What `cannotBeBroken` (spec C1-7) is worth on this card, in `cardValue` units: the break it prevents, priced
    67	 * by current exposure. A Forward already carrying damage is a §12.4.5 break waiting to happen; an undamaged one
    68	 * only gains the right to block something bigger. It does NOT stop the §12.4.4 zero-power process, so a Forward
    69	 * below 1000 power is beyond saving; a Backup is not subject to either rule process and is only being protected
    70	 * from a direct break effect, hence the bare floor.
    71	 */
    72	export function protectionValue(state: GameState, c: FieldCard, isForward: boolean): number {
    73	  const power = powerOf(state, c)
    74	  if (isForward && power < 1000) return 0
    75	  const exposure = power >= 1000 ? Math.min(1, c.damage / power) : 0
    76	  return (0.25 + 0.75 * exposure) * (cardValue(defOf(state, c.id)) + power / 1000)
    77	}
    78	
    79	/**
    80	 * Rung C1: the until-end-of-turn qualities `material` cannot see. Without them every Haste target and every
    81	 * `cannotBeBroken` target scores identically and the AI falls back to first-in-order (Codex MAJOR).
    82	 *
    83	 * Zero unless the card actually carries a keyword or a flag, so a vanilla board — no card in the C1 pool prints
    84	 * a keyword — evaluates to exactly the pre-C1 number and the seed-1 gate is untouched. `powerBonus` needs no
    85	 * term of its own: `powerOf` already delegates to `effectivePower` (spec C1-7).
    86	 */
    87	function abilityTerms(state: GameState, p: PlayerId, c: FieldCard, isForward: boolean, w: Weights): number {
    88	  const def = defOf(state, c.id)
    89	  if (!c.granted.length && !c.flags.length && !def.keywords.length) return 0
    90	  const kw = keywordsOf(state, c)
    91	  let v = 0
    92	  // `enteredTurn` and `attackedThisTurn` enter the evaluation here, and only here.
    93	  if (kw.has('haste')) v += w.haste * hasteUnlock(state, p, c, isForward)
    94	  // Brave (§15.2.1): does not dull to attack, so it threatens and still blocks. Flat — a standing quality.
    95	  if (kw.has('brave') && isForward) v += w.brave
    96	  if (c.flags.includes('cannotBeBroken')) v += w.protection * protectionValue(state, c, isForward)
    97	  return v
    98	}
    99	
   100	function material(state: GameState, p: PlayerId, w: Weights): number {
   101	  const ps = state.players[p]
   102	  let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
   103	  for (const c of ps.forwards) {
   104	    // Split permanent from until-end-of-turn power: `powerOf` is printed + `powerBonus`, and the two are not
   105	    // worth the same. `threat` deliberately keeps using the full figure — a temporary bonus does swing combat
   106	    // this turn, which is exactly what `threat` measures.
   107	    const total = powerOf(state, c)
   108	    const permanent = Math.max(0, total - c.powerBonus)
   109	    const temporary = total - permanent
   110	    v += ((permanent / 1000) * w.forwardPower + (temporary / 1000) * w.temporaryPower) * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
   111	    if (c.status === 'active') v += (total / 1000) * w.threat   // active-power tempo: this side's own attack-ready threat
   112	    v += abilityTerms(state, p, c, true, w)
   113	  }
   114	  for (const c of ps.backups) v += abilityTerms(state, p, c, false, w)
   115	  v += Math.min(ps.backups.length, MAX_BACKUPS) * w.backup
   116	  v += Math.min(ps.hand.length, HAND_SIZE_LIMIT) * w.hand + Math.max(0, ps.hand.length - HAND_SIZE_LIMIT) * w.hand * 0.25
   117	  for (const id of ps.hand) v += cardValue(defOf(state, id)) * w.handQuality
   118	  v += ps.deck.length * w.deck
   119	  return v
   120	}
   121	
   122	export function evaluate(state: GameState, me: PlayerId, weights: Weights = DEFAULT_WEIGHTS, aggression = 0.5): number {
   123	  if (aggression < 0 || aggression > 1) throw new RangeError(`aggression must be within [0, 1], got ${aggression}`)
   124	  const opp = opponentOf(me)
   125	  if (state.result) return state.result.winner === me ? weights.terminal : state.result.winner === opp ? -weights.terminal : 0
   126	  const mine = material(state, me, weights) * 2 * (1 - aggression)
   127	  const theirs = material(state, opp, weights) * 2 * aggression
   128	  return mine - theirs
   129	}
     1	import { ELEMENTS, type CardId, type Command, type Element, type FieldCard, type Frame, type Pending, type PlayerId, type PlayerView, type Resolution, type TriggerEvent } from '@fftcg/engine'
     2	
     3	/**
     4	 * Canonical, cross-determinisation identity for search (spec D-2). **This is the crux of the rung.**
     5	 *
     6	 * `Command` embeds `CardId` everywhere, and `determinise()` mints fresh sequential synthetic ids for hidden
     7	 * cards on every iteration. So raw commands cannot key a tree in either direction:
     8	 *   - the same numeric id can mean a DIFFERENT card in a different world  → false matches, and the search
     9	 *     pools statistics for two unrelated moves;
    10	 *   - the same semantic card gets a DIFFERENT id in another world         → false splits, and the search
    11	 *     never accumulates enough visits on anything to choose well.
    12	 * Neither shows up as a crash or an illegal move. Both just make the search quietly worse than greedy,
    13	 * which is why `ActionKey` correctness is pinned by unit tests and not by a win-rate gate.
    14	 *
    15	 * The rule: **a key names what a human would name.** Public cards are identified by where they sit, because
    16	 * both players can see that and it survives redeterminisation. Private cards are identified by what they
    17	 * are, because their id is meaningless outside one world.
    18	 */
    19	
    20	/**
    21	 * A card reference that means the same thing in every determinisation.
    22	 *
    23	 *  - `f0:2`  — player 0's forwards, index 2 (public: position is observable and stable)
    24	 *  - `b1:0`  — player 1's backups, index 0
    25	 *  - `z0:3`  — player 0's break zone, index 3 (public and ordered)
    26	 *  - `h:9-074C#1` — the SECOND copy of 9-074C in the root player's own hand. Hand cards are private, so
    27	 *    position in a determinised hand is meaningless; the card CODE plus an occurrence counter is what a
    28	 *    player actually distinguishes. Two copies of one code are interchangeable, which is why the counter is
    29	 *    by code and not by id.
    30	 *  - `?`     — a hidden card with no canonical identity (an opponent hand card the root player cannot name).
    31	 *    A key containing `?` must never be used to pool statistics; see `isOpaque`.
    32	 */
    33	export type CardRef = string
    34	
    35	/** Canonical identity of one action, stable across determinisations. */
    36	export type ActionKey = string
    37	
    38	/**
    39	 * Canonical digest of what the ROOT player can observe after an action. Nodes are
    40	 * `(parent history, ActionKey, ObservationKey)`, because an action alone does not identify the resulting
    41	 * information set: turn advancement draws cards automatically (`phases.ts`), so two identical actions can
    42	 * leave the root player in observably different positions. Every id inside — including in `attack`,
    43	 * `pending` and `resolution` — is replaced by a `CardRef`.
    44	 */
    45	export type ObservationKey = string
    46	
    47	/** A key is opaque if any part of it names a card the root player cannot identify. */
    48	export function isOpaque(key: string): boolean {
    49	  return key.includes('?')
    50	}
    51	
    52	/**
    53	 * The contract the implementation must satisfy. Written here as documentation-with-teeth: the tests in
    54	 * `test/keys.test.ts` assert exactly these properties, and they are the ones a tournament cannot check.
    55	 *
    56	 *  1. DETERMINISM     — `actionKey(v, c)` depends only on `v` and `c`, never on iteration order or a Map.
    57	 *  2. NO FALSE MATCH  — two commands naming different card CODES never share a key, even when their
    58	 *                       `CardId`s collide across worlds.
    59	 *  3. NO FALSE SPLIT  — the same semantic action in two determinisations shares a key, even though its
    60	 *                       `CardId`s differ.
    61	 *  4. TOTALITY        — every `Command` variant produces a key; sets (attackers, targets, payment sources,
    62	 *                       assignments, modes) are normalised by sorting, because order is not semantic.
    63	 *  5. ROUND TRIP      — `decodeAction(view, key)` returns a command that is legal in THIS determinisation,
    64	 *                       or null when the key names something absent from this world. The tree stores keys;
    65	 *                       only the root returns a real `Command`.
    66	 */
    67	export interface KeyContract {
    68	  actionKey(view: PlayerView, command: Command): ActionKey
    69	  observationKey(view: PlayerView): ObservationKey
    70	  decodeAction(view: PlayerView, key: ActionKey): Command | null
    71	  cardRef(view: PlayerView, id: number, root: PlayerId): CardRef
    72	}
    73	
    74	// ---------------------------------------------------------------------------
    75	// Grammar
    76	// ---------------------------------------------------------------------------
    77	
    78	/** The one ref that names nothing, and the only place `?` is minted — so `isOpaque` and the index agree. */
    79	const OPAQUE: CardRef = '?'
    80	
    81	/** `|` separates a key's fields, `,` its list items, `@` binds a scalar to a ref. No `CardRef` contains any
    82	 *  of the three: zone refs are `[a-z]\d:\d+` and hand refs are `h:<code>#<n>` over this pool's code alphabet. */
    83	const FIELD = '|'
    84	
    85	/** Code-unit comparison. `localeCompare` is locale- and ICU-version-dependent, i.e. not deterministic (D-8). */
    86	const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
    87	
    88	/** Total order on `ActionKey`/`ObservationKey` for every caller that has to sort keys (D-8). */
    89	export function compareKeys(a: string, b: string): number {
    90	  return cmpStr(a, b)
    91	}
    92	
    93	/** Zone refs split into `(zone, index)` so they compare by index NUMERICALLY: plain string order puts `f0:10`
    94	 *  before `f0:2`, which would silently make a sorted attacker list depend on how full the field is. */
    95	function refParts(ref: CardRef): readonly [string, number] {
    96	  const i = ref.lastIndexOf(':')
    97	  const tail = ref.slice(i + 1)
    98	  if (i < 0 || !/^\d+$/.test(tail)) return [ref, -1]
    99	  return [ref.slice(0, i), Number(tail)]
   100	}
   101	
   102	function compareRefs(a: CardRef, b: CardRef): number {
   103	  const [za, ia] = refParts(a)
   104	  const [zb, ib] = refParts(b)
   105	  return cmpStr(za, zb) || ia - ib
   106	}
   107	
   108	const splitList = (s: string): string[] => (s === '' ? [] : s.split(','))
   109	const joinRefs = (refs: readonly CardRef[]): string => [...refs].sort(compareRefs).join(',')
   110	
   111	/** `ref@tag` items — payment discards (element) and party-damage assignments (amount). Sorted by ref first,
   112	 *  so the tag only ever breaks a tie between two refs that cannot both occur in a legal command anyway. */
   113	function joinTagged(items: readonly (readonly [CardRef, string])[]): string {
   114	  return [...items]
   115	    .sort((a, b) => compareRefs(a[0], b[0]) || cmpStr(a[1], b[1]))
   116	    .map(([ref, tag]) => `${ref}@${tag}`)
   117	    .join(',')
   118	}
   119	
   120	function splitTagged(s: string): (readonly [CardRef, string])[] | null {
   121	  const out: (readonly [CardRef, string])[] = []
   122	  for (const item of splitList(s)) {
   123	    const at = item.lastIndexOf('@')
   124	    if (at < 0) return null
   125	    out.push([item.slice(0, at), item.slice(at + 1)] as const)
   126	  }
   127	  return out
   128	}
   129	
   130	// ---------------------------------------------------------------------------
   131	// cardRef
   132	// ---------------------------------------------------------------------------
   133	
   134	interface RefIndex {
   135	  readonly byId: ReadonlyMap<CardId, CardRef>
   136	  /** A ref can name SEVERAL ids: two copies of one code in hand are interchangeable and share a ref. */
   137	  readonly byRef: ReadonlyMap<CardRef, readonly CardId[]>
   138	}
   139	
   140	/**
   141	 * One index per `(view, root)`. Sound to cache because `viewFor` returns a `structuredClone` nothing mutates,
   142	 * and the index is a pure function of the view. The `Map`s are only ever LOOKED UP, never iterated, so no
   143	 * insertion order can leak into a key (D-8) — the ordering that does appear in keys comes from `sort`.
   144	 */
   145	const INDEX_CACHE = new WeakMap<PlayerView, [RefIndex | undefined, RefIndex | undefined]>()
   146	
   147	function buildIndex(view: PlayerView, root: PlayerId): RefIndex {
   148	  const byId = new Map<CardId, CardRef>()
   149	  const byRef = new Map<CardRef, CardId[]>()
   150	  const put = (id: CardId, ref: CardRef): void => {
   151	    byId.set(id, ref)
   152	    const bucket = byRef.get(ref)
   153	    if (bucket) bucket.push(id)
   154	    else byRef.set(ref, [id])
   155	  }
   156	  // Public zones, in a fixed order over arrays — position IS the identity, and it is identical in every
   157	  // determinisation of one view because `determinise` copies the fields across verbatim.
   158	  for (const p of [0, 1] as const) {
   159	    const f = view.fields[p]
   160	    f.forwards.forEach((c, i) => put(c.id, `f${p}:${i}`))
   161	    f.backups.forEach((c, i) => put(c.id, `b${p}:${i}`))
   162	    f.damageZone.forEach((id, i) => put(id, `d${p}:${i}`))
   163	    f.breakZone.forEach((id, i) => put(id, `z${p}:${i}`))
   164	  }
   165	  // The root's own hand is the only private zone it can name, and it names it by CODE: a hand position is an
   166	  // artefact of one world, and `determinise` is free to hand the same numeric id to a different code in the next.
   167	  if (root === view.me) {
   168	    for (const id of view.hand) {
   169	      const code = view.cards[id]?.code
   170	      if (code === undefined) continue   // a hand card whose instance the view omits cannot be named at all
   171	      // No occurrence counter: two copies of one code in hand are INTERCHANGEABLE, so casting "the second Red
   172	      // Mage" is the same move as casting the first. Numbering them split one semantic action into two tree
   173	      // edges, halving the visits on each — a false split of exactly the kind D-2 exists to prevent, and one
   174	      // that no win-rate gate would show. Lists keep repeats, so a two-copy discard is still a multiset.
   175	      put(id, `h:${code}`)
   176	    }
   177	  }
   178	  return { byId, byRef }
   179	}
   180	
   181	function indexFor(view: PlayerView, root: PlayerId): RefIndex {
   182	  let slots = INDEX_CACHE.get(view)
   183	  if (!slots) {
   184	    slots = [undefined, undefined]
   185	    INDEX_CACHE.set(view, slots)
   186	  }
   187	  const hit = slots[root]
   188	  if (hit) return hit
   189	  const built = buildIndex(view, root)
   190	  slots[root] = built
   191	  return built
   192	}
   193	
   194	export function cardRef(view: PlayerView, id: CardId, root: PlayerId): CardRef {
   195	  return indexFor(view, root).byId.get(id) ?? OPAQUE
   196	}
   197	
   198	// ---------------------------------------------------------------------------
   199	// actionKey
   200	// ---------------------------------------------------------------------------
   201	
   202	export function actionKey(view: PlayerView, command: Command): ActionKey {
   203	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   204	  const head = `${command.type}${FIELD}p${command.player}`
   205	  switch (command.type) {
   206	    case 'chooseFirst':
   207	      return `${head}${FIELD}${command.goFirst ? 'first' : 'second'}`
   208	    case 'mulligan':
   209	      return `${head}${FIELD}${command.redraw ? 'redraw' : 'keep'}`
   210	    case 'castCharacter':
   211	    case 'castSummon': {
   212	      // Payment sources are a SET: `generateCp` and `pay` are both order-insensitive, and `enumeratePayments`
   213	      // emits backups in field order but hand discards in hand order, which differs between worlds.
   214	      const dull = joinRefs(command.payment.dullBackups.map(r))
   215	      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
   216	      return `${head}${FIELD}${r(command.card)}${FIELD}${dull}${FIELD}${discards}`
   217	    }
   218	    case 'declareAttack':
   219	      // `applyDeclareAttack` sorts the party itself, so attacker order carries no meaning to normalise away.
   220	      return `${head}${FIELD}${joinRefs(command.attackers.map(r))}`
   221	    case 'declareBlock':
   222	      return `${head}${FIELD}${command.blocker === null ? '-' : r(command.blocker)}`
   223	    case 'assignPartyDamage':
   224	      return `${head}${FIELD}${joinTagged(command.assignments.map((a) => [r(a.target), String(a.amount)] as const))}`
   225	    case 'discardToHandSize':
   226	      return `${head}${FIELD}${joinRefs(command.cards.map(r))}`
   227	    case 'chooseTargets':
   228	      return `${head}${FIELD}${joinRefs(command.targets.map(r))}`
   229	    case 'chooseMode':
   230	      // Mode answers are indices into the pending's printed `labels`, not ids — already world-independent.
   231	      return `${head}${FIELD}${[...command.modes].sort((a, b) => a - b).join(',')}`
   232	    case 'activateAbility': {
   233	      // `abilityId` is a printed-clause identity, already world-independent — unlike a card id, it needs no
   234	      // canonicalisation. The source and every CP source do, exactly as for a cast.
   235	      const dull = joinRefs(command.payment.dullBackups.map(r))
   236	      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
   237	      return `${head}${FIELD}${r(command.source)}${FIELD}${command.abilityId}${FIELD}${dull}${FIELD}${discards}`
   238	    }
   239	    case 'pass':
   240	    case 'concede':
   241	      return head
   242	    // A new `Command` variant must fail to compile here rather than collapse into some other action's key.
   243	    default: { const _exhaustive: never = command; return _exhaustive }
   244	  }
   245	}
   246	
   247	// ---------------------------------------------------------------------------
   248	// decodeAction
   249	// ---------------------------------------------------------------------------
   250	
   251	interface DecodeCtx {
   252	  readonly view: PlayerView
   253	  readonly player: PlayerId
   254	  /** Key fields after `<type>|p<n>`, so `args[0]` is the first argument of every variant. */
   255	  readonly args: readonly string[]
   256	  /** The id this world gives a ref, or null when this world has no such card (an opaque ref included). */
   257	  id(ref: string | undefined): CardId | null
   258	  ids(field: string | undefined): CardId[] | null
   259	  /** Does this world owe exactly the decision the key answers? A world that diverged does not. */
   260	  pendingIs<K extends Pending['kind']>(kind: K): Extract<Pending, { kind: K }> | null
   261	}
   262	
   263	type Decoder = (ctx: DecodeCtx) => Command | null
   264	
   265	const isElement = (s: string): s is Element => (ELEMENTS as readonly string[]).includes(s)
   266	
   267	const distinct = (xs: readonly number[]): boolean => new Set(xs).size === xs.length
   268	
   269	/**
   270	 * One decoder per `Command` variant. A `Record` keyed on `Command['type']` rather than a switch with a `never`
   271	 * default: the switch subject here is an untrusted string off a key, so it cannot carry the exhaustiveness
   272	 * check itself — but a missing entry in this record does stop the file compiling.
   273	 */
   274	const DECODERS: Record<Command['type'], Decoder> = {
   275	  chooseFirst: ({ player, args, pendingIs }) => {
   276	    if (!pendingIs('chooseFirst')) return null
   277	    const v = args[0]
   278	    return v === 'first' || v === 'second' ? { type: 'chooseFirst', player, goFirst: v === 'first' } : null
   279	  },
   280	  mulligan: ({ player, args, pendingIs }) => {
   281	    if (!pendingIs('mulligan')) return null
   282	    const v = args[0]
   283	    return v === 'redraw' || v === 'keep' ? { type: 'mulligan', player, redraw: v === 'redraw' } : null
   284	  },
   285	  castCharacter: (ctx) => decodeCast(ctx, 'castCharacter'),
   286	  castSummon: (ctx) => decodeCast(ctx, 'castSummon'),
   287	  activateAbility: ({ view, player, args, id, ids }) => {
   288	    if (view.pending) return null
   289	    const source = id(args[0])
   290	    const abilityId = args[1]
   291	    const dullBackups = ids(args[2])
   292	    const items = splitTagged(args[3] ?? '')
   293	    if (source === null || !abilityId || !dullBackups || !items) return null
   294	    const discards: { card: CardId; element: Element }[] = []
   295	    for (const [ref, tag] of items) {
   296	      const src = id(ref)
   297	      if (src === null || !isElement(tag)) return null
   298	      discards.push({ card: src, element: tag })
   299	    }
   300	    return { type: 'activateAbility', player, source, abilityId, payment: { dullBackups, discards } }
   301	  },
   302	  declareAttack: ({ view, player, args, ids }) => {
   303	    if (view.pending) return null
   304	    const attackers = ids(args[0])
   305	    return attackers && attackers.length > 0 ? { type: 'declareAttack', player, attackers } : null
   306	  },
   307	  declareBlock: ({ player, args, id, pendingIs }) => {
   308	    if (!pendingIs('declareBlock')) return null
   309	    if (args[0] === '-') return { type: 'declareBlock', player, blocker: null }
   310	    const blocker = id(args[0])
   311	    return blocker === null ? null : { type: 'declareBlock', player, blocker }
   312	  },
   313	  assignPartyDamage: ({ player, args, id, pendingIs }) => {
   314	    if (!pendingIs('assignPartyDamage')) return null
   315	    const items = splitTagged(args[0] ?? '')
   316	    if (!items) return null
   317	    const assignments: { target: CardId; amount: number }[] = []
   318	    for (const [ref, tag] of items) {
   319	      const target = id(ref)
   320	      const amount = Number(tag)
   321	      if (target === null || !/^\d+$/.test(tag) || !Number.isSafeInteger(amount)) return null
   322	      assignments.push({ target, amount })
   323	    }
   324	    return { type: 'assignPartyDamage', player, assignments }
   325	  },
   326	  discardToHandSize: ({ player, args, ids, pendingIs }) => {
   327	    const pending = pendingIs('discardToHandSize')
   328	    const cards = ids(args[0])
   329	    if (!pending || !cards || cards.length !== pending.count || !distinct(cards)) return null
   330	    return { type: 'discardToHandSize', player, cards }
   331	  },
   332	  chooseTargets: ({ player, args, ids, pendingIs }) => {
   333	    const pending = pendingIs('chooseTargets')
   334	    const targets = ids(args[0])
   335	    if (!pending || !targets || !distinct(targets)) return null
   336	    if (targets.length < pending.min || targets.length > pending.max) return null
   337	    // `apply` re-checks membership anyway (spec C1-6); checking it here is what makes a key naming a target
   338	    // this world does not offer decode to null instead of to a command that throws.
   339	    if (targets.some((t) => !pending.candidates.includes(t))) return null
   340	    return { type: 'chooseTargets', player, targets }
   341	  },
   342	  chooseMode: ({ player, args, pendingIs }) => {
   343	    const pending = pendingIs('chooseMode')
   344	    if (!pending) return null
   345	    const modes: number[] = []
   346	    for (const s of splitList(args[0] ?? '')) {
   347	      if (!/^\d+$/.test(s)) return null
   348	      modes.push(Number(s))
   349	    }
   350	    if (modes.length < pending.min || modes.length > pending.max || !distinct(modes)) return null
   351	    if (modes.some((m) => m >= pending.labels.length)) return null
   352	    return { type: 'chooseMode', player, modes }
   353	  },
   354	  pass: ({ view, player }) => (view.pending ? null : { type: 'pass', player }),
   355	  concede: ({ player }) => ({ type: 'concede', player }),   // §2.1: always legal
   356	}
   357	
   358	function decodeCast({ view, player, args, id, ids }: DecodeCtx, type: 'castCharacter' | 'castSummon'): Command | null {
   359	  if (view.pending) return null
   360	  const card = id(args[0])
   361	  const dullBackups = ids(args[1])
   362	  const items = splitTagged(args[2] ?? '')
   363	  if (card === null || !dullBackups || !items) return null
   364	  const discards: { card: CardId; element: Element }[] = []
   365	  for (const [ref, tag] of items) {
   366	    const src = id(ref)
   367	    if (src === null || !isElement(tag)) return null
   368	    discards.push({ card: src, element: tag })
   369	  }
   370	  return { type, player, card, payment: { dullBackups, discards } }
   371	}
   372	
   373	export function decodeAction(view: PlayerView, key: ActionKey): Command | null {
   374	  const parts = key.split(FIELD)
   375	  const decoder = (DECODERS as Record<string, Decoder | undefined>)[parts[0] ?? '']
   376	  const player: PlayerId | null = parts[1] === 'p0' ? 0 : parts[1] === 'p1' ? 1 : null
   377	  if (!decoder || player === null) return null
   378	  const idx = indexFor(view, view.me)
   379	  // Consumption spans the WHOLE command, not one list: interchangeable copies share a ref, so a cast whose
   380	  // payment discards another copy of the card being cast would otherwise decode both to the same id and be
   381	  // rejected as "cannot discard the card you are casting". Decoding in field order hands out distinct copies.
   382	  const taken = new Map<CardRef, number>()
   383	  const take = (ref: CardRef): CardId | null => {
   384	    const n = taken.get(ref) ?? 0
   385	    const v = idx.byRef.get(ref)?.[n]
   386	    if (v === undefined) return null
   387	    taken.set(ref, n + 1)
   388	    return v
   389	  }
   390	  const ctx: DecodeCtx = {
   391	    view,
   392	    player,
   393	    args: parts.slice(2),
   394	    id: (ref) => (ref === undefined ? null : take(ref)),
   395	    ids: (field) => {
   396	      if (field === undefined) return null
   397	      const out: CardId[] = []
   398	      for (const ref of splitList(field)) {
   399	        const v = take(ref)
   400	        if (v === null) return null
   401	        out.push(v)
   402	      }
   403	      return out
   404	    },
   405	    pendingIs: (kind) => {
   406	      const p = view.pending
   407	      return p !== null && p.kind === kind && p.player === player ? (p as Extract<Pending, { kind: typeof kind }>) : null
   408	    },
   409	  }
   410	  return decoder(ctx)
   411	}
   412	
   413	// ---------------------------------------------------------------------------
   414	// observationKey
   415	// ---------------------------------------------------------------------------
   416	
   417	function fieldDigest(view: PlayerView, p: PlayerId): string {
   418	  const f = view.fields[p]
   419	  const code = (id: CardId): string => view.cards[id]?.code ?? OPAQUE
   420	  // Position is carried by array order, so the digest holds only what a card IS and what has happened to it —
   421	  // no id survives, which is what makes two worlds that differ only in synthetic numbering agree here.
   422	  const card = (c: FieldCard): string => [
   423	    code(c.id), c.status, c.damage, c.enteredTurn, c.attackedThisTurn ? 1 : 0,
   424	    [...c.granted].sort(cmpStr).join('+'), c.powerBonus, [...c.flags].sort(cmpStr).join('+'),
   425	  ].join('/')
   426	  return [
   427	    `dk${f.deckCount}`, `hd${f.handCount}`,
   428	    `fw[${f.forwards.map(card).join(',')}]`, `bk[${f.backups.map(card).join(',')}]`,
   429	    `dz[${f.damageZone.map(code).join(',')}]`, `bz[${f.breakZone.map(code).join(',')}]`,
   430	  ].join(';')
   431	}
   432	
   433	function triggerDigest(view: PlayerView, e: TriggerEvent | null): string {
   434	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   435	  if (e === null) return '-'
   436	  switch (e.kind) {
   437	    case 'damage':
   438	      return `dmg.${r(e.source)}.${e.sourceController}.${e.target === null ? '-' : r(e.target)}.${e.victim ?? '-'}.${e.amount}`
   439	    case 'zoneChange':
   440	      return `zc.${r(e.card)}.${e.from}.${e.to}.${e.controller}.${e.owner}`
   441	    default: { const _exhaustive: never = e; return _exhaustive }
   442	  }
   443	}
   444	
   445	function frameDigest(view: PlayerView, f: Frame | null): string {
   446	  if (f === null) return '-'
   447	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   448	  // `path` and `modes` are program-counter indices, already world-independent. `chosen` is a binding whose
   449	  // order no effect depends on, so it normalises like every other set.
   450	  return [f.abilityId, r(f.source), f.controller, f.path.join('.'), joinRefs(f.chosen.map(r)), triggerDigest(view, f.triggerEvent), f.modes.join('.')].join('/')
   451	}
   452	
   453	function resolutionDigest(view: PlayerView, res: Resolution): string {
   454	  // `steps` is real, observable resource state (it is what `MAX_RESOLUTION_STEPS` bounds), so two positions
   455	  // that differ only in how much agenda budget is left are genuinely different positions.
   456	  return `${frameDigest(view, res.active)}~[${res.queue.map((f) => frameDigest(view, f)).join(',')}]~${res.continuation ?? '-'}~${res.steps}`
   457	}
   458	
   459	function pendingDigest(view: PlayerView, pending: Pending | null): string {
   460	  if (pending === null) return '-'
   461	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   462	  const head = `${pending.kind}/${pending.player}`
   463	  switch (pending.kind) {
   464	    case 'chooseFirst':
   465	    case 'mulligan':
   466	    case 'declareBlock':
   467	    case 'assignPartyDamage':
   468	      return head
   469	    case 'discardToHandSize':
   470	      return `${head}/${pending.count}`
   471	    case 'chooseTargets':
   472	      return `${head}/${pending.min}-${pending.max}/${joinRefs(pending.candidates.map(r))}`
   473	    case 'chooseMode':
   474	      // Labels are printed wording, and JSON-quoted so a label containing a separator cannot forge one.
   475	      return `${head}/${pending.min}-${pending.max}/${pending.labels.map((l) => JSON.stringify(l)).join(',')}`
   476	    default: { const _exhaustive: never = pending; return _exhaustive }
   477	  }
   478	}
   479	
   480	export function observationKey(view: PlayerView): ObservationKey {
   481	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   482	  const at = view.attack
   483	  // The root's own hand is a MULTISET of codes: hand position is not observable to anyone (`h:` refs are by
   484	  // code and occurrence), so two worlds that drew the same cards in a different order are the same information set.
   485	  const hand = view.hand.map((id) => view.cards[id]?.code ?? OPAQUE).sort(cmpStr).join(',')
   486	  return [
   487	    `me${view.me}`, `t${view.turn}`, `tp${view.turnPlayer}`, view.phase, `pr${view.priority}`,
   488	    `fp${view.firstPlayer}`, `mu${view.mulliganDecided.map((b) => (b ? 1 : 0)).join('')}`,
   489	    `end:${view.result === null ? '-' : `${view.result.winner ?? 'draw'}/${view.result.reason}`}`,
   490	    `hand[${hand}]`,
   491	    `F0:${fieldDigest(view, 0)}`,
   492	    `F1:${fieldDigest(view, 1)}`,
   493	    `atk:${at === null ? '-' : `${at.step}/${joinRefs(at.attackers.map(r))}/${at.blocker === null ? '-' : r(at.blocker)}`}`,
   494	    `pend:${pendingDigest(view, view.pending)}`,
   495	    `res:${resolutionDigest(view, view.resolution)}`,
   496	  ].join(FIELD)
   497	}
   498	
   499	/** Pins the implementations to the documented contract — a signature drift stops compiling here. */
   500	export const KEY_CONTRACT: KeyContract = { cardRef, actionKey, observationKey, decodeAction }
   501	
   502	// ---------------------------------------------------------------------------
   503	// The worker-safe search seam (spec D-7)
   504	// ---------------------------------------------------------------------------
   505	
   506	/**
   507	 * Everything the search needs, and nothing it must not have (spec D-9). There is deliberately no
   508	 * `GameState` here: the search derives every simulated world from a `PlayerView` plus the two publicly
   509	 * declared deck lists, so it cannot read the live game even by accident.
   510	 *
   511	 * Structured-cloneable by construction, so D2 can post it to a Web Worker unchanged.
   512	 */
   513	export interface SearchInput {
   514	  readonly view: PlayerView
   515	  /** Both players' publicly declared lists. Semantically a MULTISET — sort a copy before sampling. */
   516	  readonly decks: readonly [readonly string[], readonly string[]]
   517	  readonly iterations: number
   518	  /** Seeds the world sampling, expansion and tie-breaking streams — kept separate (spec D-8). */
   519	  readonly seed: number
   520	  readonly rolloutCommandCap: number
   521	  readonly explorationC: number
   522	}
   523	
   524	/** Counters that make cost measurable rather than guessed (spec D-A4). */
   525	export interface SearchDiagnostics {
   526	  readonly determinisations: number
   527	  readonly treeApplies: number
   528	  readonly rolloutApplies: number
   529	  readonly evaluations: number
   530	  readonly nodes: number
   531	  readonly maxCommandDepth: number
   532	  /** Root children as `[ActionKey, visits, meanReward]`, best first — the search's own explanation. */
   533	  readonly rootChildren: readonly (readonly [ActionKey, number, number])[]
   534	}
   535	
   536	export interface SearchResult {
   537	  readonly command: Command
   538	  readonly diagnostics: SearchDiagnostics
   539	}

exec
/bin/zsh -lc "nl -ba packages/ai/src/candidates.ts | sed -n '180,360p'; nl -ba packages/ai/src/evaluate.ts; nl -ba packages/ai/src/ismcts/keys.ts | sed -n '1,200p'; nl -ba packages/ai/src/ismcts/keys.ts | sed -n '200,380p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   180	      default: break
   181	    }
   182	  }
   183	  return d
   184	}
   185	
   186	const targetScore = (state: GameState, me: PlayerId, source: CardId, effects: readonly Effect[], id: CardId): number =>
   187	  (sideOf(state, id) === me ? 1 : -1) * targetDelta(state, source, effects, id)
   188	
   189	/** Descending score, ties broken by ascending id/index — a total order, so ranking is deterministic. */
   190	function rankBy(items: readonly number[], score: (x: number) => number): { ranked: number[]; scores: number[] } {
   191	  const scored = items.map((x) => ({ x, s: score(x) })).sort((a, b) => b.s - a.s || a.x - b.x)
   192	  return { ranked: scored.map((e) => e.x), scores: scored.map((e) => e.s) }
   193	}
   194	
   195	/** Best k in `min..max` by prefix sum of an already-descending score list, ties to the SMALLER k. */
   196	function bestSize(scores: readonly number[], min: number, max: number): number {
   197	  let best = min, bestSum = -Infinity, sum = 0
   198	  for (let k = 0; k <= max; k++) {
   199	    if (k > 0) sum += scores[k - 1] ?? 0
   200	    if (k >= min && sum > bestSum) { best = k; bestSum = sum }
   201	  }
   202	  return best
   203	}
   204	
   205	/**
   206	 * The bounded, deterministic answer set for a `min..max` choice over `ranked` (already best-first). The policy's
   207	 * own pick comes FIRST — a budget-starved `greedyStep` scores only the first candidate, so the first candidate
   208	 * has to be the answer the policy actually wants, not the smallest one. Then the other sizes, then a couple of
   209	 * swap-variants at the best size so a well-resourced search can overrule a wrong ranking. Never enumerates
   210	 * C(N, k).
   211	 */
   212	function policyChoices(ranked: readonly number[], scores: readonly number[], min: number, max: number): number[][] {
   213	  const top = bestSize(scores, min, max)
   214	  const out: number[][] = []
   215	  const seen = new Set<string>()
   216	  const push = (xs: number[]) => {
   217	    const key = [...xs].sort((a, b) => a - b).join(',')
   218	    if (seen.has(key) || out.length >= CHOICE_CANDIDATE_CAP) return
   219	    seen.add(key)
   220	    out.push(xs)
   221	  }
   222	  push(ranked.slice(0, top))
   223	  for (let k = min; k <= max; k++) push(ranked.slice(0, k))
   224	  for (let j = top; top >= 1 && j < ranked.length; j++) push([...ranked.slice(0, top - 1), ranked[j] as number])
   225	  return out
   226	}
   227	
   228	/**
   229	 * One-ply value of running `effects` for `me` — the same units as `targetDelta`, used to rank the MODES of a
   230	 * `chooseModes` (they are only distinguishable by what their branches would do). A chooser inside a mode is
   231	 * priced as the policy's own best answer to it.
   232	 */
   233	function effectsValue(state: GameState, me: PlayerId, source: CardId, controller: PlayerId, effects: readonly Effect[]): number {
   234	  let v = 0
   235	  for (const eff of effects) {
   236	    if (eff.kind === 'chooseTargets') {
   237	      const { scores } = rankBy(targetCandidates(state, source, controller, eff.from), (id) => targetScore(state, me, source, eff.then, id))
   238	      const max = Math.min(eff.max, scores.length)
   239	      if (eff.min > scores.length) continue   // cannot legally resolve: the executor no-ops it
   240	      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
   241	    } else if (eff.kind === 'forEach') {
   242	      for (const id of targetCandidates(state, source, controller, eff.from)) v += targetScore(state, me, source, eff.do, id)
   243	    } else if (eff.kind === 'chooseModes') {
   244	      const { scores } = rankBy(eff.modes.map((_, i) => i), (i) => effectsValue(state, me, source, controller, eff.modes[i]?.effects ?? []))
   245	      const max = Math.min(eff.max, scores.length)
   246	      for (let k = 0; k < bestSize(scores, Math.min(eff.min, max), max); k++) v += scores[k] as number
   247	    }
   248	    // Everything else needs a `chosen` binding it does not have at this level, so it contributes nothing.
   249	  }
   250	  return v
   251	}
   252	
   253	function chooseTargetsCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseTargets' }>): Command[] {
   254	  const frame = state.resolution.active
   255	  const node = suspendedEffect(state)
   256	  if (!frame || node?.kind !== 'chooseTargets') return legalCommands(state, player).filter((c) => c.type === 'chooseTargets')
   257	  const { ranked, scores } = rankBy(pending.candidates, (id) => targetScore(state, player, frame.source, node.then, id))
   258	  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
   259	  // Sorted so the emitted command is structurally identical to the one `legalCommands` lists for the same set.
   260	  // Target order is semantically irrelevant (`applyChooseTargets` is order-insensitive), but any consumer that
   261	  // matches an AI command against `legalCommands` by deep equality — the web's `sameCommand` is the obvious one —
   262	  // would otherwise fail to find a perfectly legal answer, because the policy emits best-first.
   263	  return picks.map((targets) => ({ type: 'chooseTargets', player, targets: [...targets].sort((a, b) => a - b) }))
   264	}
   265	
   266	function chooseModeCandidates(state: GameState, player: PlayerId, pending: Extract<Pending, { kind: 'chooseMode' }>): Command[] {
   267	  const frame = state.resolution.active
   268	  const node = suspendedEffect(state)
   269	  if (!frame || node?.kind !== 'chooseModes') return legalCommands(state, player).filter((c) => c.type === 'chooseMode')
   270	  const { ranked, scores } = rankBy(node.modes.map((_, i) => i), (i) => effectsValue(state, player, frame.source, frame.controller, node.modes[i]?.effects ?? []))
   271	  const picks = policyChoices(ranked, scores, pending.min, Math.min(pending.max, ranked.length))
   272	  return picks.map((modes) => ({ type: 'chooseMode', player, modes: [...modes].sort((a, b) => a - b) }))
   273	}
   274	
   275	export function candidateCommands(state: GameState, player: PlayerId): Command[] {
   276	  if (state.result || actingPlayer(state) !== player) return []
   277	  const out: Command[] = []
   278	  const pending = state.pending
   279	  if (pending) {
   280	    switch (pending.kind) {
   281	      case 'chooseFirst': return [{ type: 'chooseFirst', player, goFirst: true }, { type: 'chooseFirst', player, goFirst: false }]
   282	      case 'mulligan': return [{ type: 'mulligan', player, redraw: false }, { type: 'mulligan', player, redraw: true }]
   283	      case 'discardToHandSize': {
   284	        const byValue = [...state.players[player].hand].sort((a, b) => cardValue(defOf(state, a)) - cardValue(defOf(state, b)))
   285	        return [{ type: 'discardToHandSize', player, cards: byValue.slice(0, pending.count) }]
   286	      }
   287	      case 'declareBlock': return [{ type: 'declareBlock', player, blocker: null }, ...legalBlockers(state, player).map((blocker) => ({ type: 'declareBlock' as const, player, blocker }))]
   288	      case 'assignPartyDamage': return legalPartyDamageAssignments(state).map((assignments) => ({ type: 'assignPartyDamage' as const, player, assignments }))
   289	      case 'chooseTargets': return chooseTargetsCandidates(state, player, pending)
   290	      case 'chooseMode': return chooseModeCandidates(state, player, pending)
   291	      // W3: exhaustive — a new Pending kind must fail to compile here rather than silently falling through to phase generation.
   292	      default: { const _exhaustive: never = pending; return _exhaustive }
   293	    }
   294	  }
   295	  if (state.phase === 'main1' || state.phase === 'main2') {
   296	    for (const card of state.players[player].hand) {
   297	      if (castCheck(state, player, card) !== null) continue
   298	      const payment = preferredPayment(state, player, card)
   299	      if (!payment) continue
   300	      out.push({ type: defOf(state, card).type === 'summon' ? 'castSummon' : 'castCharacter', player, card, payment })
   301	    }
   302	    // C3: activations must be emitted HERE, not merely be legal. This list — not `legalCommands` — is what
   303	    // both agents search, so a command that exists only in `legalCommands` is invisible to the AI, which
   304	    // would have shipped an opponent that never used an ability it was holding.
   305	    out.push(...activationCandidates(state, player))
   306	    out.push({ type: 'pass', player })
   307	  } else if (state.phase === 'attack' && state.attack?.step === 'declaration') {
   308	    for (const attackers of boundedAttackSets(state, player)) out.push({ type: 'declareAttack', player, attackers })
   309	    out.push({ type: 'pass', player })
   310	  }
   311	  return out
   312	}
   313	
   314	/**
   315	 * One activation per (source card, clause), each with the single payment `preferredPaymentFor` likes best.
   316	 *
   317	 * One rather than all: `legalCommands` enumerates every minimal payment, and offering the search a dozen
   318	 * spellings of the same move would multiply the branching factor for a choice that is nearly always
   319	 * value-dominated. This mirrors what casting already does a few lines above.
   320	 */
   321	function activationCandidates(state: GameState, player: PlayerId): Command[] {
   322	  const out: Command[] = []
   323	  const ps = state.players[player]
   324	  const sources = [...ps.hand, ...ps.breakZone, ...ps.forwards.map((c) => c.id), ...ps.backups.map((c) => c.id)]
   325	  for (const source of sources) {
   326	    for (const ability of defOf(state, source).abilities ?? []) {
   327	      if (ability.trigger.kind !== 'activated') continue
   328	      if (activationCheck(state, player, source, ability.id) !== null) continue
   329	      const payment = preferredPaymentFor(state, player, abilityCpRequirement(source, ability.trigger.cost))
   330	      if (!payment) continue
   331	      out.push({ type: 'activateAbility', player, source, abilityId: ability.id, payment })
   332	    }
   333	  }
   334	  return out
   335	}
     1	import { DAMAGE_TO_LOSE, HAND_SIZE_LIMIT, MAX_BACKUPS, defOf, keywordsOf, opponentOf, powerOf, type FieldCard, type GameState, type PlayerId } from '@fftcg/engine'
     2	import { cardValue } from './cardValue.js'
     3	
     4	export interface Weights {
     5	  damage: number
     6	  forwardPower: number
     7	  forwardPresence: number
     8	  dullFactor: number
     9	  backup: number
    10	  hand: number
    11	  handQuality: number
    12	  deck: number
    13	  threat: number
    14	  terminal: number
    15	  /** Rung C1. All three are worth exactly zero on a board with no granted keywords and no flags. */
    16	  haste: number
    17	  brave: number
    18	  protection: number
    19	  /**
    20	   * Rung C3. The rate at which `powerBonus` — power that EXPIRES at end of turn — counts toward material,
    21	   * against `forwardPower` for power the card actually has.
    22	   *
    23	   * Without this the two are identical, and the arithmetic worked out exactly wrong. Losing an active
    24	   * 2000-power Undead Princess costs `2×1.2 + 4 + 2×0.8 = 8.0`; giving another Forward +4000 gains
    25	   * `4×1.2 + 4×0.8 = 8.0`. A dead heat — and `greedyStep` keeps the EARLIER command on a tie, so it would
    26	   * sacrifice a permanent body for a bonus that vanishes at end of turn, whether or not anything came of it.
    27	   * The bonus still counts fully toward `threat`, because a temporary bonus really does swing combat THIS
    28	   * turn; what it must not do is masquerade as a permanent gain.
    29	   */
    30	  temporaryPower: number
    31	}
    32	
    33	export const DEFAULT_WEIGHTS: Weights = {
    34	  damage: 30,
    35	  forwardPower: 1.2,
    36	  forwardPresence: 4,
    37	  dullFactor: 0.6,
    38	  backup: 5,
    39	  hand: 2,
    40	  handQuality: 0.5,
    41	  deck: 0.1,
    42	  threat: 0.8,
    43	  terminal: 100_000,
    44	  haste: 1.0,
    45	  brave: 0.6,
    46	  protection: 0.5,
    47	  temporaryPower: 0.4,
    48	}
    49	
    50	/**
    51	 * What Haste (§15.2.3) is worth on this card RIGHT NOW, in power/1000 units and ignoring whether the card
    52	 * already has it: exactly what it unlocks — an attack this turn by a Forward that entered this turn. On a
    53	 * Forward that is dull, has already attacked, is not this turn's, or was already attack-eligible (§10.1.2.1.1),
    54	 * Haste changes nothing and this is 0, so it can never outrank a real option (spec C1, "The AI").
    55	 *
    56	 * Exported because `evaluate` prices Haste a card HAS and the target policy prices Haste a card WOULD BE GIVEN;
    57	 * they must agree, or the AI picks a target whose value it then fails to see.
    58	 */
    59	export function hasteUnlock(state: GameState, controller: PlayerId, c: FieldCard, isForward: boolean): number {
    60	  if (!isForward || state.turnPlayer !== controller) return 0   // Backups never attack; on the opponent's turn it is eligible next turn regardless
    61	  if (c.status !== 'active' || c.attackedThisTurn || c.enteredTurn < state.turn) return 0
    62	  return 1 + powerOf(state, c) / 1000
    63	}
    64	
    65	/**
    66	 * What `cannotBeBroken` (spec C1-7) is worth on this card, in `cardValue` units: the break it prevents, priced
    67	 * by current exposure. A Forward already carrying damage is a §12.4.5 break waiting to happen; an undamaged one
    68	 * only gains the right to block something bigger. It does NOT stop the §12.4.4 zero-power process, so a Forward
    69	 * below 1000 power is beyond saving; a Backup is not subject to either rule process and is only being protected
    70	 * from a direct break effect, hence the bare floor.
    71	 */
    72	export function protectionValue(state: GameState, c: FieldCard, isForward: boolean): number {
    73	  const power = powerOf(state, c)
    74	  if (isForward && power < 1000) return 0
    75	  const exposure = power >= 1000 ? Math.min(1, c.damage / power) : 0
    76	  return (0.25 + 0.75 * exposure) * (cardValue(defOf(state, c.id)) + power / 1000)
    77	}
    78	
    79	/**
    80	 * Rung C1: the until-end-of-turn qualities `material` cannot see. Without them every Haste target and every
    81	 * `cannotBeBroken` target scores identically and the AI falls back to first-in-order (Codex MAJOR).
    82	 *
    83	 * Zero unless the card actually carries a keyword or a flag, so a vanilla board — no card in the C1 pool prints
    84	 * a keyword — evaluates to exactly the pre-C1 number and the seed-1 gate is untouched. `powerBonus` needs no
    85	 * term of its own: `powerOf` already delegates to `effectivePower` (spec C1-7).
    86	 */
    87	function abilityTerms(state: GameState, p: PlayerId, c: FieldCard, isForward: boolean, w: Weights): number {
    88	  const def = defOf(state, c.id)
    89	  if (!c.granted.length && !c.flags.length && !def.keywords.length) return 0
    90	  const kw = keywordsOf(state, c)
    91	  let v = 0
    92	  // `enteredTurn` and `attackedThisTurn` enter the evaluation here, and only here.
    93	  if (kw.has('haste')) v += w.haste * hasteUnlock(state, p, c, isForward)
    94	  // Brave (§15.2.1): does not dull to attack, so it threatens and still blocks. Flat — a standing quality.
    95	  if (kw.has('brave') && isForward) v += w.brave
    96	  if (c.flags.includes('cannotBeBroken')) v += w.protection * protectionValue(state, c, isForward)
    97	  return v
    98	}
    99	
   100	function material(state: GameState, p: PlayerId, w: Weights): number {
   101	  const ps = state.players[p]
   102	  let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
   103	  for (const c of ps.forwards) {
   104	    // Split permanent from until-end-of-turn power: `powerOf` is printed + `powerBonus`, and the two are not
   105	    // worth the same. `threat` deliberately keeps using the full figure — a temporary bonus does swing combat
   106	    // this turn, which is exactly what `threat` measures.
   107	    const total = powerOf(state, c)
   108	    const permanent = Math.max(0, total - c.powerBonus)
   109	    const temporary = total - permanent
   110	    v += ((permanent / 1000) * w.forwardPower + (temporary / 1000) * w.temporaryPower) * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
   111	    if (c.status === 'active') v += (total / 1000) * w.threat   // active-power tempo: this side's own attack-ready threat
   112	    v += abilityTerms(state, p, c, true, w)
   113	  }
   114	  for (const c of ps.backups) v += abilityTerms(state, p, c, false, w)
   115	  v += Math.min(ps.backups.length, MAX_BACKUPS) * w.backup
   116	  v += Math.min(ps.hand.length, HAND_SIZE_LIMIT) * w.hand + Math.max(0, ps.hand.length - HAND_SIZE_LIMIT) * w.hand * 0.25
   117	  for (const id of ps.hand) v += cardValue(defOf(state, id)) * w.handQuality
   118	  v += ps.deck.length * w.deck
   119	  return v
   120	}
   121	
   122	export function evaluate(state: GameState, me: PlayerId, weights: Weights = DEFAULT_WEIGHTS, aggression = 0.5): number {
   123	  if (aggression < 0 || aggression > 1) throw new RangeError(`aggression must be within [0, 1], got ${aggression}`)
   124	  const opp = opponentOf(me)
   125	  if (state.result) return state.result.winner === me ? weights.terminal : state.result.winner === opp ? -weights.terminal : 0
   126	  const mine = material(state, me, weights) * 2 * (1 - aggression)
   127	  const theirs = material(state, opp, weights) * 2 * aggression
   128	  return mine - theirs
   129	}
     1	import { ELEMENTS, type CardId, type Command, type Element, type FieldCard, type Frame, type Pending, type PlayerId, type PlayerView, type Resolution, type TriggerEvent } from '@fftcg/engine'
     2	
     3	/**
     4	 * Canonical, cross-determinisation identity for search (spec D-2). **This is the crux of the rung.**
     5	 *
     6	 * `Command` embeds `CardId` everywhere, and `determinise()` mints fresh sequential synthetic ids for hidden
     7	 * cards on every iteration. So raw commands cannot key a tree in either direction:
     8	 *   - the same numeric id can mean a DIFFERENT card in a different world  → false matches, and the search
     9	 *     pools statistics for two unrelated moves;
    10	 *   - the same semantic card gets a DIFFERENT id in another world         → false splits, and the search
    11	 *     never accumulates enough visits on anything to choose well.
    12	 * Neither shows up as a crash or an illegal move. Both just make the search quietly worse than greedy,
    13	 * which is why `ActionKey` correctness is pinned by unit tests and not by a win-rate gate.
    14	 *
    15	 * The rule: **a key names what a human would name.** Public cards are identified by where they sit, because
    16	 * both players can see that and it survives redeterminisation. Private cards are identified by what they
    17	 * are, because their id is meaningless outside one world.
    18	 */
    19	
    20	/**
    21	 * A card reference that means the same thing in every determinisation.
    22	 *
    23	 *  - `f0:2`  — player 0's forwards, index 2 (public: position is observable and stable)
    24	 *  - `b1:0`  — player 1's backups, index 0
    25	 *  - `z0:3`  — player 0's break zone, index 3 (public and ordered)
    26	 *  - `h:9-074C#1` — the SECOND copy of 9-074C in the root player's own hand. Hand cards are private, so
    27	 *    position in a determinised hand is meaningless; the card CODE plus an occurrence counter is what a
    28	 *    player actually distinguishes. Two copies of one code are interchangeable, which is why the counter is
    29	 *    by code and not by id.
    30	 *  - `?`     — a hidden card with no canonical identity (an opponent hand card the root player cannot name).
    31	 *    A key containing `?` must never be used to pool statistics; see `isOpaque`.
    32	 */
    33	export type CardRef = string
    34	
    35	/** Canonical identity of one action, stable across determinisations. */
    36	export type ActionKey = string
    37	
    38	/**
    39	 * Canonical digest of what the ROOT player can observe after an action. Nodes are
    40	 * `(parent history, ActionKey, ObservationKey)`, because an action alone does not identify the resulting
    41	 * information set: turn advancement draws cards automatically (`phases.ts`), so two identical actions can
    42	 * leave the root player in observably different positions. Every id inside — including in `attack`,
    43	 * `pending` and `resolution` — is replaced by a `CardRef`.
    44	 */
    45	export type ObservationKey = string
    46	
    47	/** A key is opaque if any part of it names a card the root player cannot identify. */
    48	export function isOpaque(key: string): boolean {
    49	  return key.includes('?')
    50	}
    51	
    52	/**
    53	 * The contract the implementation must satisfy. Written here as documentation-with-teeth: the tests in
    54	 * `test/keys.test.ts` assert exactly these properties, and they are the ones a tournament cannot check.
    55	 *
    56	 *  1. DETERMINISM     — `actionKey(v, c)` depends only on `v` and `c`, never on iteration order or a Map.
    57	 *  2. NO FALSE MATCH  — two commands naming different card CODES never share a key, even when their
    58	 *                       `CardId`s collide across worlds.
    59	 *  3. NO FALSE SPLIT  — the same semantic action in two determinisations shares a key, even though its
    60	 *                       `CardId`s differ.
    61	 *  4. TOTALITY        — every `Command` variant produces a key; sets (attackers, targets, payment sources,
    62	 *                       assignments, modes) are normalised by sorting, because order is not semantic.
    63	 *  5. ROUND TRIP      — `decodeAction(view, key)` returns a command that is legal in THIS determinisation,
    64	 *                       or null when the key names something absent from this world. The tree stores keys;
    65	 *                       only the root returns a real `Command`.
    66	 */
    67	export interface KeyContract {
    68	  actionKey(view: PlayerView, command: Command): ActionKey
    69	  observationKey(view: PlayerView): ObservationKey
    70	  decodeAction(view: PlayerView, key: ActionKey): Command | null
    71	  cardRef(view: PlayerView, id: number, root: PlayerId): CardRef
    72	}
    73	
    74	// ---------------------------------------------------------------------------
    75	// Grammar
    76	// ---------------------------------------------------------------------------
    77	
    78	/** The one ref that names nothing, and the only place `?` is minted — so `isOpaque` and the index agree. */
    79	const OPAQUE: CardRef = '?'
    80	
    81	/** `|` separates a key's fields, `,` its list items, `@` binds a scalar to a ref. No `CardRef` contains any
    82	 *  of the three: zone refs are `[a-z]\d:\d+` and hand refs are `h:<code>#<n>` over this pool's code alphabet. */
    83	const FIELD = '|'
    84	
    85	/** Code-unit comparison. `localeCompare` is locale- and ICU-version-dependent, i.e. not deterministic (D-8). */
    86	const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
    87	
    88	/** Total order on `ActionKey`/`ObservationKey` for every caller that has to sort keys (D-8). */
    89	export function compareKeys(a: string, b: string): number {
    90	  return cmpStr(a, b)
    91	}
    92	
    93	/** Zone refs split into `(zone, index)` so they compare by index NUMERICALLY: plain string order puts `f0:10`
    94	 *  before `f0:2`, which would silently make a sorted attacker list depend on how full the field is. */
    95	function refParts(ref: CardRef): readonly [string, number] {
    96	  const i = ref.lastIndexOf(':')
    97	  const tail = ref.slice(i + 1)
    98	  if (i < 0 || !/^\d+$/.test(tail)) return [ref, -1]
    99	  return [ref.slice(0, i), Number(tail)]
   100	}
   101	
   102	function compareRefs(a: CardRef, b: CardRef): number {
   103	  const [za, ia] = refParts(a)
   104	  const [zb, ib] = refParts(b)
   105	  return cmpStr(za, zb) || ia - ib
   106	}
   107	
   108	const splitList = (s: string): string[] => (s === '' ? [] : s.split(','))
   109	const joinRefs = (refs: readonly CardRef[]): string => [...refs].sort(compareRefs).join(',')
   110	
   111	/** `ref@tag` items — payment discards (element) and party-damage assignments (amount). Sorted by ref first,
   112	 *  so the tag only ever breaks a tie between two refs that cannot both occur in a legal command anyway. */
   113	function joinTagged(items: readonly (readonly [CardRef, string])[]): string {
   114	  return [...items]
   115	    .sort((a, b) => compareRefs(a[0], b[0]) || cmpStr(a[1], b[1]))
   116	    .map(([ref, tag]) => `${ref}@${tag}`)
   117	    .join(',')
   118	}
   119	
   120	function splitTagged(s: string): (readonly [CardRef, string])[] | null {
   121	  const out: (readonly [CardRef, string])[] = []
   122	  for (const item of splitList(s)) {
   123	    const at = item.lastIndexOf('@')
   124	    if (at < 0) return null
   125	    out.push([item.slice(0, at), item.slice(at + 1)] as const)
   126	  }
   127	  return out
   128	}
   129	
   130	// ---------------------------------------------------------------------------
   131	// cardRef
   132	// ---------------------------------------------------------------------------
   133	
   134	interface RefIndex {
   135	  readonly byId: ReadonlyMap<CardId, CardRef>
   136	  /** A ref can name SEVERAL ids: two copies of one code in hand are interchangeable and share a ref. */
   137	  readonly byRef: ReadonlyMap<CardRef, readonly CardId[]>
   138	}
   139	
   140	/**
   141	 * One index per `(view, root)`. Sound to cache because `viewFor` returns a `structuredClone` nothing mutates,
   142	 * and the index is a pure function of the view. The `Map`s are only ever LOOKED UP, never iterated, so no
   143	 * insertion order can leak into a key (D-8) — the ordering that does appear in keys comes from `sort`.
   144	 */
   145	const INDEX_CACHE = new WeakMap<PlayerView, [RefIndex | undefined, RefIndex | undefined]>()
   146	
   147	function buildIndex(view: PlayerView, root: PlayerId): RefIndex {
   148	  const byId = new Map<CardId, CardRef>()
   149	  const byRef = new Map<CardRef, CardId[]>()
   150	  const put = (id: CardId, ref: CardRef): void => {
   151	    byId.set(id, ref)
   152	    const bucket = byRef.get(ref)
   153	    if (bucket) bucket.push(id)
   154	    else byRef.set(ref, [id])
   155	  }
   156	  // Public zones, in a fixed order over arrays — position IS the identity, and it is identical in every
   157	  // determinisation of one view because `determinise` copies the fields across verbatim.
   158	  for (const p of [0, 1] as const) {
   159	    const f = view.fields[p]
   160	    f.forwards.forEach((c, i) => put(c.id, `f${p}:${i}`))
   161	    f.backups.forEach((c, i) => put(c.id, `b${p}:${i}`))
   162	    f.damageZone.forEach((id, i) => put(id, `d${p}:${i}`))
   163	    f.breakZone.forEach((id, i) => put(id, `z${p}:${i}`))
   164	  }
   165	  // The root's own hand is the only private zone it can name, and it names it by CODE: a hand position is an
   166	  // artefact of one world, and `determinise` is free to hand the same numeric id to a different code in the next.
   167	  if (root === view.me) {
   168	    for (const id of view.hand) {
   169	      const code = view.cards[id]?.code
   170	      if (code === undefined) continue   // a hand card whose instance the view omits cannot be named at all
   171	      // No occurrence counter: two copies of one code in hand are INTERCHANGEABLE, so casting "the second Red
   172	      // Mage" is the same move as casting the first. Numbering them split one semantic action into two tree
   173	      // edges, halving the visits on each — a false split of exactly the kind D-2 exists to prevent, and one
   174	      // that no win-rate gate would show. Lists keep repeats, so a two-copy discard is still a multiset.
   175	      put(id, `h:${code}`)
   176	    }
   177	  }
   178	  return { byId, byRef }
   179	}
   180	
   181	function indexFor(view: PlayerView, root: PlayerId): RefIndex {
   182	  let slots = INDEX_CACHE.get(view)
   183	  if (!slots) {
   184	    slots = [undefined, undefined]
   185	    INDEX_CACHE.set(view, slots)
   186	  }
   187	  const hit = slots[root]
   188	  if (hit) return hit
   189	  const built = buildIndex(view, root)
   190	  slots[root] = built
   191	  return built
   192	}
   193	
   194	export function cardRef(view: PlayerView, id: CardId, root: PlayerId): CardRef {
   195	  return indexFor(view, root).byId.get(id) ?? OPAQUE
   196	}
   197	
   198	// ---------------------------------------------------------------------------
   199	// actionKey
   200	// ---------------------------------------------------------------------------
   200	// ---------------------------------------------------------------------------
   201	
   202	export function actionKey(view: PlayerView, command: Command): ActionKey {
   203	  const r = (id: CardId): CardRef => cardRef(view, id, view.me)
   204	  const head = `${command.type}${FIELD}p${command.player}`
   205	  switch (command.type) {
   206	    case 'chooseFirst':
   207	      return `${head}${FIELD}${command.goFirst ? 'first' : 'second'}`
   208	    case 'mulligan':
   209	      return `${head}${FIELD}${command.redraw ? 'redraw' : 'keep'}`
   210	    case 'castCharacter':
   211	    case 'castSummon': {
   212	      // Payment sources are a SET: `generateCp` and `pay` are both order-insensitive, and `enumeratePayments`
   213	      // emits backups in field order but hand discards in hand order, which differs between worlds.
   214	      const dull = joinRefs(command.payment.dullBackups.map(r))
   215	      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
   216	      return `${head}${FIELD}${r(command.card)}${FIELD}${dull}${FIELD}${discards}`
   217	    }
   218	    case 'declareAttack':
   219	      // `applyDeclareAttack` sorts the party itself, so attacker order carries no meaning to normalise away.
   220	      return `${head}${FIELD}${joinRefs(command.attackers.map(r))}`
   221	    case 'declareBlock':
   222	      return `${head}${FIELD}${command.blocker === null ? '-' : r(command.blocker)}`
   223	    case 'assignPartyDamage':
   224	      return `${head}${FIELD}${joinTagged(command.assignments.map((a) => [r(a.target), String(a.amount)] as const))}`
   225	    case 'discardToHandSize':
   226	      return `${head}${FIELD}${joinRefs(command.cards.map(r))}`
   227	    case 'chooseTargets':
   228	      return `${head}${FIELD}${joinRefs(command.targets.map(r))}`
   229	    case 'chooseMode':
   230	      // Mode answers are indices into the pending's printed `labels`, not ids — already world-independent.
   231	      return `${head}${FIELD}${[...command.modes].sort((a, b) => a - b).join(',')}`
   232	    case 'activateAbility': {
   233	      // `abilityId` is a printed-clause identity, already world-independent — unlike a card id, it needs no
   234	      // canonicalisation. The source and every CP source do, exactly as for a cast.
   235	      const dull = joinRefs(command.payment.dullBackups.map(r))
   236	      const discards = joinTagged(command.payment.discards.map((d) => [r(d.card), d.element] as const))
   237	      return `${head}${FIELD}${r(command.source)}${FIELD}${command.abilityId}${FIELD}${dull}${FIELD}${discards}`
   238	    }
   239	    case 'pass':
   240	    case 'concede':
   241	      return head
   242	    // A new `Command` variant must fail to compile here rather than collapse into some other action's key.
   243	    default: { const _exhaustive: never = command; return _exhaustive }
   244	  }
   245	}
   246	
   247	// ---------------------------------------------------------------------------
   248	// decodeAction
   249	// ---------------------------------------------------------------------------
   250	
   251	interface DecodeCtx {
   252	  readonly view: PlayerView
   253	  readonly player: PlayerId
   254	  /** Key fields after `<type>|p<n>`, so `args[0]` is the first argument of every variant. */
   255	  readonly args: readonly string[]
   256	  /** The id this world gives a ref, or null when this world has no such card (an opaque ref included). */
   257	  id(ref: string | undefined): CardId | null
   258	  ids(field: string | undefined): CardId[] | null
   259	  /** Does this world owe exactly the decision the key answers? A world that diverged does not. */
   260	  pendingIs<K extends Pending['kind']>(kind: K): Extract<Pending, { kind: K }> | null
   261	}
   262	
   263	type Decoder = (ctx: DecodeCtx) => Command | null
   264	
   265	const isElement = (s: string): s is Element => (ELEMENTS as readonly string[]).includes(s)
   266	
   267	const distinct = (xs: readonly number[]): boolean => new Set(xs).size === xs.length
   268	
   269	/**
   270	 * One decoder per `Command` variant. A `Record` keyed on `Command['type']` rather than a switch with a `never`
   271	 * default: the switch subject here is an untrusted string off a key, so it cannot carry the exhaustiveness
   272	 * check itself — but a missing entry in this record does stop the file compiling.
   273	 */
   274	const DECODERS: Record<Command['type'], Decoder> = {
   275	  chooseFirst: ({ player, args, pendingIs }) => {
   276	    if (!pendingIs('chooseFirst')) return null
   277	    const v = args[0]
   278	    return v === 'first' || v === 'second' ? { type: 'chooseFirst', player, goFirst: v === 'first' } : null
   279	  },
   280	  mulligan: ({ player, args, pendingIs }) => {
   281	    if (!pendingIs('mulligan')) return null
   282	    const v = args[0]
   283	    return v === 'redraw' || v === 'keep' ? { type: 'mulligan', player, redraw: v === 'redraw' } : null
   284	  },
   285	  castCharacter: (ctx) => decodeCast(ctx, 'castCharacter'),
   286	  castSummon: (ctx) => decodeCast(ctx, 'castSummon'),
   287	  activateAbility: ({ view, player, args, id, ids }) => {
   288	    if (view.pending) return null
   289	    const source = id(args[0])
   290	    const abilityId = args[1]
   291	    const dullBackups = ids(args[2])
   292	    const items = splitTagged(args[3] ?? '')
   293	    if (source === null || !abilityId || !dullBackups || !items) return null
   294	    const discards: { card: CardId; element: Element }[] = []
   295	    for (const [ref, tag] of items) {
   296	      const src = id(ref)
   297	      if (src === null || !isElement(tag)) return null
   298	      discards.push({ card: src, element: tag })
   299	    }
   300	    return { type: 'activateAbility', player, source, abilityId, payment: { dullBackups, discards } }
   301	  },
   302	  declareAttack: ({ view, player, args, ids }) => {
   303	    if (view.pending) return null
   304	    const attackers = ids(args[0])
   305	    return attackers && attackers.length > 0 ? { type: 'declareAttack', player, attackers } : null
   306	  },
   307	  declareBlock: ({ player, args, id, pendingIs }) => {
   308	    if (!pendingIs('declareBlock')) return null
   309	    if (args[0] === '-') return { type: 'declareBlock', player, blocker: null }
   310	    const blocker = id(args[0])
   311	    return blocker === null ? null : { type: 'declareBlock', player, blocker }
   312	  },
   313	  assignPartyDamage: ({ player, args, id, pendingIs }) => {
   314	    if (!pendingIs('assignPartyDamage')) return null
   315	    const items = splitTagged(args[0] ?? '')
   316	    if (!items) return null
   317	    const assignments: { target: CardId; amount: number }[] = []
   318	    for (const [ref, tag] of items) {
   319	      const target = id(ref)
   320	      const amount = Number(tag)
   321	      if (target === null || !/^\d+$/.test(tag) || !Number.isSafeInteger(amount)) return null
   322	      assignments.push({ target, amount })
   323	    }
   324	    return { type: 'assignPartyDamage', player, assignments }
   325	  },
   326	  discardToHandSize: ({ player, args, ids, pendingIs }) => {
   327	    const pending = pendingIs('discardToHandSize')
   328	    const cards = ids(args[0])
   329	    if (!pending || !cards || cards.length !== pending.count || !distinct(cards)) return null
   330	    return { type: 'discardToHandSize', player, cards }
   331	  },
   332	  chooseTargets: ({ player, args, ids, pendingIs }) => {
   333	    const pending = pendingIs('chooseTargets')
   334	    const targets = ids(args[0])
   335	    if (!pending || !targets || !distinct(targets)) return null
   336	    if (targets.length < pending.min || targets.length > pending.max) return null
   337	    // `apply` re-checks membership anyway (spec C1-6); checking it here is what makes a key naming a target
   338	    // this world does not offer decode to null instead of to a command that throws.
   339	    if (targets.some((t) => !pending.candidates.includes(t))) return null
   340	    return { type: 'chooseTargets', player, targets }
   341	  },
   342	  chooseMode: ({ player, args, pendingIs }) => {
   343	    const pending = pendingIs('chooseMode')
   344	    if (!pending) return null
   345	    const modes: number[] = []
   346	    for (const s of splitList(args[0] ?? '')) {
   347	      if (!/^\d+$/.test(s)) return null
   348	      modes.push(Number(s))
   349	    }
   350	    if (modes.length < pending.min || modes.length > pending.max || !distinct(modes)) return null
   351	    if (modes.some((m) => m >= pending.labels.length)) return null
   352	    return { type: 'chooseMode', player, modes }
   353	  },
   354	  pass: ({ view, player }) => (view.pending ? null : { type: 'pass', player }),
   355	  concede: ({ player }) => ({ type: 'concede', player }),   // §2.1: always legal
   356	}
   357	
   358	function decodeCast({ view, player, args, id, ids }: DecodeCtx, type: 'castCharacter' | 'castSummon'): Command | null {
   359	  if (view.pending) return null
   360	  const card = id(args[0])
   361	  const dullBackups = ids(args[1])
   362	  const items = splitTagged(args[2] ?? '')
   363	  if (card === null || !dullBackups || !items) return null
   364	  const discards: { card: CardId; element: Element }[] = []
   365	  for (const [ref, tag] of items) {
   366	    const src = id(ref)
   367	    if (src === null || !isElement(tag)) return null
   368	    discards.push({ card: src, element: tag })
   369	  }
   370	  return { type, player, card, payment: { dullBackups, discards } }
   371	}
   372	
   373	export function decodeAction(view: PlayerView, key: ActionKey): Command | null {
   374	  const parts = key.split(FIELD)
   375	  const decoder = (DECODERS as Record<string, Decoder | undefined>)[parts[0] ?? '']
   376	  const player: PlayerId | null = parts[1] === 'p0' ? 0 : parts[1] === 'p1' ? 1 : null
   377	  if (!decoder || player === null) return null
   378	  const idx = indexFor(view, view.me)
   379	  // Consumption spans the WHOLE command, not one list: interchangeable copies share a ref, so a cast whose
   380	  // payment discards another copy of the card being cast would otherwise decode both to the same id and be

exec
/bin/zsh -lc "rg -n \"decodeAction\\(|actionKey\\(|candidateCommands|isOpaque\" packages/ai/src/ismcts packages/ai/test -g '*.ts' | head -240 && nl -ba packages/ai/src/ismcts/search.ts | sed -n '320,470p' && nl -ba packages/ai/src/ismcts/agent.ts | sed -n '1,180p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/ai/src/ismcts/keys.ts:31: *    A key containing `?` must never be used to pool statistics; see `isOpaque`.
packages/ai/src/ismcts/keys.ts:48:export function isOpaque(key: string): boolean {
packages/ai/src/ismcts/keys.ts:56: *  1. DETERMINISM     — `actionKey(v, c)` depends only on `v` and `c`, never on iteration order or a Map.
packages/ai/src/ismcts/keys.ts:63: *  5. ROUND TRIP      — `decodeAction(view, key)` returns a command that is legal in THIS determinisation,
packages/ai/src/ismcts/keys.ts:68:  actionKey(view: PlayerView, command: Command): ActionKey
packages/ai/src/ismcts/keys.ts:70:  decodeAction(view: PlayerView, key: ActionKey): Command | null
packages/ai/src/ismcts/keys.ts:78:/** The one ref that names nothing, and the only place `?` is minted — so `isOpaque` and the index agree. */
packages/ai/src/ismcts/keys.ts:202:export function actionKey(view: PlayerView, command: Command): ActionKey {
packages/ai/src/ismcts/keys.ts:373:export function decodeAction(view: PlayerView, key: ActionKey): Command | null {
packages/ai/test/ismcts-keys.test.ts:6:import { candidateCommands } from '../src/candidates.js'
packages/ai/test/ismcts-keys.test.ts:8:import { KEY_CONTRACT, actionKey, cardRef, compareKeys, decodeAction, isOpaque, observationKey } from '../src/ismcts/keys.js'
packages/ai/test/ismcts-keys.test.ts:24:/** Put a clause on the agenda and run it until it asks its question — the state `candidateCommands` meets in play. */
packages/ai/test/ismcts-keys.test.ts:81:    expect(isOpaque(actionKey(v, { type: 'castCharacter', player: 1, card: oppHand, payment: NO_PAYMENT }))).toBe(true)
packages/ai/test/ismcts-keys.test.ts:91:    expect(actionKey(a, cmd)).toBe(actionKey(a, cmd))
packages/ai/test/ismcts-keys.test.ts:92:    expect(actionKey(b, cmd)).toBe(actionKey(a, cmd))
packages/ai/test/ismcts-keys.test.ts:132:    const ka = actionKey(va, cmd)
packages/ai/test/ismcts-keys.test.ts:133:    const kb = actionKey(vb, cmd)
packages/ai/test/ismcts-keys.test.ts:134:    expect(isOpaque(ka)).toBe(false)   // both worlds can name it: this is a real split, not two `?`s
packages/ai/test/ismcts-keys.test.ts:135:    expect(isOpaque(kb)).toBe(false)
packages/ai/test/ismcts-keys.test.ts:145:    expect(actionKey(va, cmd)).not.toBe(actionKey(vb, cmd))
packages/ai/test/ismcts-keys.test.ts:172:    const key = (v: PlayerView, id: CardId): string => actionKey(v, { type: 'castCharacter', player: 1, card: id, payment: NO_PAYMENT })
packages/ai/test/ismcts-keys.test.ts:182:    expect(actionKey(remapIds(v, 50_000), cmd(f + 50_000))).toBe(actionKey(v, cmd(f)))
packages/ai/test/ismcts-keys.test.ts:211:    const keys = all.map((c) => actionKey(v, c))
packages/ai/test/ismcts-keys.test.ts:215:    expect(actionKey(v, { type: 'pass', player: 1 })).not.toBe(actionKey(v, { type: 'pass', player: 0 }))
packages/ai/test/ismcts-keys.test.ts:227:    const same = (a: Command, b: Command): void => expect(actionKey(v, a)).toBe(actionKey(v, b))
packages/ai/test/ismcts-keys.test.ts:241:    expect(actionKey(v, { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [], discards: [{ card: h2, element: 'earth' }] } }))
packages/ai/test/ismcts-keys.test.ts:242:      .not.toBe(actionKey(v, { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [], discards: [{ card: h2, element: 'fire' }] } }))
packages/ai/test/ismcts-keys.test.ts:250:    const key = actionKey(v, { type: 'declareAttack', player: 0, attackers: [ids[10]!, ids[2]!] })
packages/ai/test/ismcts-keys.test.ts:252:    expect(actionKey(v, { type: 'declareAttack', player: 0, attackers: [ids[2]!, ids[10]!] })).toBe(key)
packages/ai/test/ismcts-keys.test.ts:259:    const cands = candidateCommands(det, p)
packages/ai/test/ismcts-keys.test.ts:261:      const key = actionKey(dv, c)
packages/ai/test/ismcts-keys.test.ts:262:      const back = decodeAction(dv, key)
packages/ai/test/ismcts-keys.test.ts:267:      expect(actionKey(dv, back!)).toBe(key)
packages/ai/test/ismcts-keys.test.ts:286:        for (const c of candidateCommands(det, p)) kinds.add(c.type)
packages/ai/test/ismcts-keys.test.ts:302:      s = apply(s, candidateCommands(det, p)[0]!).state
packages/ai/test/ismcts-keys.test.ts:336:    expect(decodeAction(v, 'chooseTargets|p0|f1:0')).toEqual({ type: 'chooseTargets', player: 0, targets: [v.fields[1].forwards[0]!.id] })
packages/ai/test/ismcts-keys.test.ts:337:    expect(decodeAction(v, 'chooseTargets|p0|f0:0')).toBeNull()        // resolves, but is not offered here
packages/ai/test/ismcts-keys.test.ts:338:    expect(decodeAction(v, 'chooseTargets|p0|f1:0,f0:0')).toBeNull()   // over the prompt's max
packages/ai/test/ismcts-keys.test.ts:339:    expect(decodeAction(v, 'chooseTargets|p1|f1:0')).toBeNull()        // not the player who owes the answer
packages/ai/test/ismcts-keys.test.ts:340:    expect(decodeAction(v, 'chooseMode|p0|0')).toBeNull()              // not the decision this world is asking
packages/ai/test/ismcts-keys.test.ts:341:    expect(decodeAction(v, 'pass|p0')).toBeNull()                      // a prompt is outstanding: pass is not legal
packages/ai/test/ismcts-keys.test.ts:344:    expect(decodeAction(withModes, 'chooseMode|p0|1')).toEqual({ type: 'chooseMode', player: 0, modes: [1] })
packages/ai/test/ismcts-keys.test.ts:345:    expect(decodeAction(withModes, 'chooseMode|p0|2')).toBeNull()
packages/ai/test/ismcts-keys.test.ts:346:    expect(decodeAction(withModes, 'chooseMode|p0|0,1')).toBeNull()
packages/ai/test/ismcts-keys.test.ts:350:    expect(decodeAction(withDiscard, `discardToHandSize|p0|h:${c0}`)).toBeNull()               // one, where two are owed
packages/ai/test/ismcts-keys.test.ts:351:    expect(decodeAction(withDiscard, `discardToHandSize|p0|h:${c0},h:${c1}`)).not.toBeNull()   // a repeated ref decodes to two DISTINCT copies
packages/ai/test/ismcts-keys.test.ts:359:    expect(decodeAction(v, 'declareAttack|p0|f0:9')).toBeNull()                 // no such position here
packages/ai/test/ismcts-keys.test.ts:360:    expect(decodeAction(v, 'castCharacter|p0|h:NOT-A-CODE#1||')).toBeNull()     // no such card in hand
packages/ai/test/ismcts-keys.test.ts:361:    expect(decodeAction(v, `castCharacter|p0|h:${v.cards[v.hand[0]!]!.code}#9||`)).toBeNull()   // not that many copies
packages/ai/test/ismcts-keys.test.ts:362:    expect(decodeAction(v, 'castCharacter|p0|?||')).toBeNull()                  // an opaque ref names nothing
packages/ai/test/ismcts-keys.test.ts:363:    expect(decodeAction(v, 'declareBlock|p0|f0:0')).toBeNull()                  // no block is owed in this world
packages/ai/test/ismcts-keys.test.ts:364:    expect(decodeAction(v, 'nonsense|p0|x')).toBeNull()
packages/ai/test/ismcts-keys.test.ts:365:    expect(decodeAction(v, '')).toBeNull()
packages/ai/test/ismcts-keys.test.ts:366:    expect(decodeAction(v, `declareAttack|p2|f0:${f}`)).toBeNull()
packages/ai/test/ismcts-keys.test.ts:368:    expect(decodeAction(v, 'concede|p1')).toEqual({ type: 'concede', player: 1 })
packages/ai/test/ismcts-keys.test.ts:516:    expect(KEY_CONTRACT.actionKey(v, { type: 'pass', player: 0 })).toBe(actionKey(v, { type: 'pass', player: 0 }))
packages/ai/test/ismcts-keys.test.ts:517:    expect(KEY_CONTRACT.decodeAction(v, 'concede|p0')).toEqual({ type: 'concede', player: 0 })
packages/ai/test/greedy.test.ts:4:import { candidateCommands } from '../src/candidates.js'
packages/ai/test/greedy.test.ts:99:    const full = candidateCommands(s, 0)
packages/ai/test/greedy.test.ts:135:    const cands = candidateCommands(s, 0)
packages/ai/test/greedy.test.ts:151:    // A candidateCommands gap for a player who is genuinely acting is a bug in the agent, not a lost game.
packages/ai/test/greedy.test.ts:154:    // rejected. `end` is a phase candidateCommands generates nothing for, with player 0 holding priority.
packages/ai/test/greedy.test.ts:157:    expect(candidateCommands(s, 0)).toEqual([])
packages/ai/test/greedy.test.ts:196:      const cands = candidateCommands(det, 0)
packages/ai/test/greedy.test.ts:307:      const cands = candidateCommands(det, 0)
packages/ai/test/greedy.test.ts:357:      const cands = candidateCommands(det, 0)
packages/ai/test/greedy.test.ts:412:      s = apply(s, candidateCommands(s, 0)[0] as Command).state   // answer the mode; a target choice follows
packages/ai/test/greedy.test.ts:457:    const cands = candidateCommands(det, 0)
packages/ai/test/candidates.test.ts:3:import { candidateCommands } from '../src/candidates.js'
packages/ai/test/candidates.test.ts:11:/** Put the clause on the agenda and run it until it asks its question — exactly the state `candidateCommands` meets in play. */
packages/ai/test/candidates.test.ts:26:describe('candidateCommands', () => {
packages/ai/test/candidates.test.ts:32:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:42:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:50:    expect(candidateCommands(s, 1)).toEqual([])
packages/ai/test/candidates.test.ts:57:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:71: * Rung C1. `legalCommands` enumerates Σ C(N, k) answers to a target choice; `candidateCommands` must instead
packages/ai/test/candidates.test.ts:75:describe('candidateCommands: the C1 one-ply target policy', () => {
packages/ai/test/candidates.test.ts:86:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:93:    expect(candidateCommands(s, 0)).toEqual(c)      // deterministic
packages/ai/test/candidates.test.ts:104:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([pumped])
packages/ai/test/candidates.test.ts:116:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([hurt])
packages/ai/test/candidates.test.ts:128:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([plain])
packages/ai/test/candidates.test.ts:142:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([dear])
packages/ai/test/candidates.test.ts:153:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([prize])
packages/ai/test/candidates.test.ts:155:    for (const cmd of candidateCommands(s, 0)) expect(() => apply(s, cmd)).not.toThrow()
packages/ai/test/candidates.test.ts:166:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([fresh])   // the 9000 gains NOTHING and must not win on power
packages/ai/test/candidates.test.ts:178:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:192:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([exposed])
packages/ai/test/candidates.test.ts:203:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:209:    expect(candidateCommands(s, 0)).toEqual(c)
packages/ai/test/candidates.test.ts:228:    const c = candidateCommands(s, 0)
packages/ai/test/candidates.test.ts:235:    const after = apply(next, candidateCommands(next, 0)[0] as Command).state
packages/ai/test/candidates.test.ts:247:    expect(candidateCommands(forged, 0)).toEqual(legalCommands(forged, 0).filter((c) => c.type === 'chooseTargets'))
packages/ai/test/candidates.test.ts:249:    expect(candidateCommands(forgedModes, 0)).toEqual(legalCommands(forgedModes, 0).filter((c) => c.type === 'chooseMode'))
packages/ai/test/candidates.test.ts:258:describe('candidateCommands: the C2 shapes', () => {
packages/ai/test/candidates.test.ts:282:    expect(targetsOf(candidateCommands(withCascade, 0)[0])).toEqual([big])
packages/ai/test/candidates.test.ts:284:    const resolved = apply(withCascade, candidateCommands(withCascade, 0)[0] as Command).state
packages/ai/test/candidates.test.ts:288:    expect(targetsOf(candidateCommands(without, 0)[0])).toEqual([small])
packages/ai/test/candidates.test.ts:304:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([backup])                     // …and the policy follows value, not type
packages/ai/test/candidates.test.ts:305:    for (const cmd of candidateCommands(s, 0)) {
packages/ai/test/candidates.test.ts:325:    expect(modesOf(candidateCommands(s, 0)[0])).toEqual([0, 1])   // "up to 2" and both are worth taking
packages/ai/test/candidates.test.ts:328:    for (let i = 0; i < 4 && t.pending; i++) t = apply(t, candidateCommands(t, 0)[0] as Command).state
packages/ai/test/candidates.test.ts:350:    expect(targetsOf(candidateCommands(s, 0)[0])).toEqual([fresh])
packages/ai/src/ismcts/search.ts:5:import { candidateCommands } from '../candidates.js'
packages/ai/src/ismcts/search.ts:9:  actionKey, compareKeys, decodeAction, isOpaque, observationKey,
packages/ai/src/ismcts/search.ts:73:   * `A(s,a)` — visits to `s` at which this canonical action was in `candidateCommands` (D-4). Incremented on
packages/ai/src/ismcts/search.ts:171: * would make the uniform draw depend on the order `candidateCommands` happened to emit in THIS determinisation,
packages/ai/src/ismcts/search.ts:369:      const cands = candidateCommands(state, actor)
packages/ai/src/ismcts/search.ts:389:        const key = actionKey(keyView, c)
packages/ai/src/ismcts/search.ts:430:    // Mirrors `GreedyAgent.decide`'s R2 policy: a gap in `candidateCommands` must fail loudly rather than fall
packages/ai/src/ismcts/search.ts:438:  if (isOpaque(best.key)) throw new Error(`searchIsmcts: root action ${best.key} names a card the root player cannot identify`)
packages/ai/src/ismcts/search.ts:447:  const command = rootCommands.get(best.key) ?? decodeAction(input.view, best.key)
packages/ai/test/ismcts-search.test.ts:6:import { candidateCommands } from '../src/candidates.js'
packages/ai/test/ismcts-search.test.ts:135:        for (const c of candidateCommands(s, actor)) {
packages/ai/test/ismcts-search.test.ts:136:          expect(actionKey(searchView(s, p), c)).toBe(actionKey(viewFor(s, p), c))
packages/ai/test/ismcts-search.test.ts:635:    // `candidateCommands` orders a discard by ASCENDING cardValue; keys order it by CODE. These two disagree
packages/ai/test/ismcts-search.test.ts:644:    const decoded = decodeAction(view, actionKey(view, unsorted))
packages/ai/test/ismcts-search.test.ts:649:    // Then: what the search returns is a command `candidateCommands` really offered — identically, not merely
packages/ai/test/ismcts-search.test.ts:653:    const cands = candidateCommands(s, 0)
   320	  [[...decks[0]].sort(compareKeys), [...decks[1]].sort(compareKeys)]
   321	
   322	const actorOf = (view: PlayerView): PlayerId => view.pending?.player ?? view.priority
   323	
   324	/**
   325	 * Root actions best-first (D-5): most VISITS, never best mean. The visit count is the robust statistic — an
   326	 * edge with three visits and a mean of 0.99 was lucky, not good, and picking by mean makes the search's answer
   327	 * a hostage to whichever rollout happened to find a win first. Ties break on the total key order, so the
   328	 * answer never depends on `Map` insertion order (D-8). Unvisited edges (available, never selected) are dropped.
   329	 */
   330	export function rankRootEdges(edges: readonly SearchEdge[]): SearchEdge[] {
   331	  return edges.filter((e) => e.visits > 0).sort((a, b) => b.visits - a.visits || compareKeys(a.key, b.key))
   332	}
   333	
   334	export function searchTree(input: SearchInput): SearchTree {
   335	  const root = input.view.me
   336	  if (input.iterations < 1) throw new RangeError(`iterations must be at least 1, got ${input.iterations}`)
   337	  if (input.view.result) throw new Error('searchIsmcts: the game is already over')
   338	  // D-9 has this function seeing a `PlayerView` and two declared lists and nothing else; the root actor is
   339	  // therefore read off the view, and asking it to move for anybody but `view.me` is a caller bug, not a
   340	  // position to be searched.
   341	  if (actorOf(input.view) !== root) throw new Error(`searchIsmcts: player ${root} is not the acting player`)
   342	
   343	  const decks = sortedDecks(input.decks)
   344	  const streams = makeStreams(input.seed)
   345	  const counters = newCounters()
   346	  const rootNode = createNode(root)
   347	  counters.nodes++
   348	  /** Fallback only: `decodeAction` against the LIVE view is the authority for what the root key means. */
   349	  const rootCommands = new Map<ActionKey, Command>()
   350	
   351	  for (let i = 0; i < input.iterations; i++) {
   352	    const [world, nextWorld] = determinise({ view: input.view, decks, rng: streams.world })
   353	    streams.world = nextWorld
   354	    counters.determinisations++
   355	
   356	    let state = world
   357	    let view = searchView(state, root)
   358	    let node = rootNode
   359	    const path: PathStep[] = []
   360	    let commands = 0
   361	
   362	    for (;;) {
   363	      // No `resolveForcedDecisions` anywhere in this loop (D-3). `apply` already settled the state to the next
   364	      // decision boundary, whoever owns it — a block, a party-damage split and an ability prompt are all
   365	      // genuine plies. Draining here would, at the root, have the rollout policy answer the very question the
   366	      // caller asked `decide` to answer.
   367	      if (state.result) break
   368	      const actor = actorOf(view)
   369	      const cands = candidateCommands(state, actor)
   370	      if (cands.length === 0) break
   371	
   372	      // Action keys are built from the ACTOR's view, not the root's. Every command in this pool has a public
   373	      // effect — a cast reveals the card, a discard puts it face up in the Break Zone, attacks/blocks/targets
   374	      // are all open — so naming the card leaks nothing the root will not observe a moment later.
   375	      //
   376	      // Keying an opponent cast from the ROOT's view instead collapses every hand cast onto one opaque
   377	      // `castCharacter|p1|?|…` edge. Measured, that pooled a 1-cost Backup with an 8000 Forward, and which one
   378	      // the world played was then drawn from the tie stream — so the modelled opponent chose among materially
   379	      // different cards UNIFORMLY AT RANDOM at the commonest decision in the game, and the availability
   380	      // counter went inert exactly where it exists to work (A tracked node visits, because the pooled edge was
   381	      // available in every world). Conditioning on the determinisation is what ISMCTS already does; pricing an
   382	      // action that only some worlds offer is precisely what `availability` is for.
   383	      //
   384	      // The OBSERVATION key stays root-only — that is where single-observer fairness actually lives.
   385	      const keyView = actor === null || actor === root ? view : searchView(state, actor)
   386	      const byKey = new Map<ActionKey, Command[]>()
   387	      const available: ActionKey[] = []
   388	      for (const c of cands) {
   389	        const key = actionKey(keyView, c)
   390	        const group = byKey.get(key)
   391	        if (group) group.push(c)
   392	        else { byKey.set(key, [c]); available.push(key) }
   393	      }
   394	      if (node === rootNode) for (const key of available) if (!rootCommands.has(key)) rootCommands.set(key, (byKey.get(key) as Command[])[0] as Command)
   395	
   396	      const { key, expansion } = selectKey(node, available, root, input.explorationC, streams)
   397	      const group = byKey.get(key) as Command[]
   398	      const command = group.length === 1 ? (group[0] as Command) : draw(group, streams, 'tie')
   399	      const edge = edgeFor(node, key)
   400	      path.push({ node, edge, available })
   401	
   402	      state = apply(state, command).state
   403	      counters.treeApplies++
   404	      commands++
   405	      view = searchView(state, root)
   406	
   407	      if (state.result) break
   408	      const nextActor = actorOf(view)
   409	      const obs = observationKey(view)
   410	      let child = edge.children.get(obs)
   411	      if (!child) {
   412	        child = createNode(nextActor)
   413	        counters.nodes++
   414	        edge.children.set(obs, child)
   415	      } else if (child.actor !== nextActor) {
   416	        // Unreachable unless `observationKey` stopped identifying a decision point: the key carries `priority`
   417	        // and the entire `pending`, which is exactly what `actorOf` reads.
   418	        throw new Error(`ISMCTS: node actor ${child.actor} != ${nextActor} for one observation key`)
   419	      }
   420	      node = child
   421	      if (expansion) break
   422	    }
   423	
   424	    const rollout = rolloutToCap(state, root, input.rolloutCommandCap, DEFAULT_WEIGHTS, counters)
   425	    counters.maxCommandDepth = Math.max(counters.maxCommandDepth, commands + rollout.commands)
   426	    backpropagate(path, rollout.reward)
   427	  }
   428	
   429	  if (rootCommands.size === 0) {
   430	    // Mirrors `GreedyAgent.decide`'s R2 policy: a gap in `candidateCommands` must fail loudly rather than fall
   431	    // through to a legal-but-catastrophic move.
   432	    throw new Error(`searchIsmcts: no candidate commands at the root in ${input.view.phase}/${input.view.pending?.kind ?? '-'}`)
   433	  }
   434	
   435	  const ranked = rankRootEdges([...rootNode.edges.values()])
   436	  const best = ranked[0]
   437	  if (!best) throw new Error('searchIsmcts: no root action was ever visited')
   438	  if (isOpaque(best.key)) throw new Error(`searchIsmcts: root action ${best.key} names a card the root player cannot identify`)
   439	
   440	  // Return the command the tree actually EVALUATED, not a fresh decode of its key. Keys sort their lists
   441	  // (order is not semantic to `apply`), but the engine preserves command order in places the search then
   442	  // reads back: Break-Zone order after a multi-card discard, and a resolution frame's `chosen` binding. So a
   443	  // decode could hand back `[V-F1,V-F7]` where the simulations had scored `[V-F7,V-F1]` — a different
   444	  // observation from the one the statistics were gathered on. `rootCommands` holds the real candidate that
   445	  // produced this key, and the root player's own cards keep their live ids through determinisation (only
   446	  // hidden cards are re-minted), so it is already a live command. Decoding stays as the fallback.
   447	  const command = rootCommands.get(best.key) ?? decodeAction(input.view, best.key)
   448	  if (!command) throw new Error(`searchIsmcts: root action ${best.key} does not decode against the live view`)
   449	
   450	  // What the counters mean (D-A4), because two of them are easy to misread: `rolloutApplies` includes the
   451	  // applies `greedyStep` spends scoring its own candidates — that is where ~95 % of the time goes, so counting
   452	  // only the commands it chose would report a cost an order of magnitude below the real one. `evaluations`
   453	  // counts the search's own leaf evaluations only (one per simulation that did not end in a terminal), not
   454	  // greedy's internal ones, which track its applies. `maxCommandDepth` is tree commands plus rollout commands.
   455	  const diagnostics: SearchDiagnostics = {
   456	    determinisations: counters.determinisations,
   457	    treeApplies: counters.treeApplies,
   458	    rolloutApplies: counters.rolloutApplies,
   459	    evaluations: counters.evaluations,
   460	    nodes: counters.nodes,
   461	    maxCommandDepth: counters.maxCommandDepth,
   462	    rootChildren: ranked.map((e) => [e.key, e.visits, meanReward(e)] as const),
   463	  }
   464	  return { root: rootNode, result: { command, diagnostics } }
   465	}
   466	
   467	/** The pure, synchronous, structured-cloneable search seam (D-7). `searchTree` is the same run with its tree. */
   468	export function searchIsmcts(input: SearchInput): SearchResult {
   469	  return searchTree(input).result
   470	}
     1	import { SYNTHETIC_ID_BASE, nextInt, seedRng, type CardId, type Command, type PlayerView, type Rng } from '@fftcg/engine'
     2	import type { Agent } from '../agent.js'
     3	import { DEFAULT_EXPLORATION_C, DEFAULT_ITERATIONS, DEFAULT_ROLLOUT_COMMAND_CAP, searchIsmcts } from './search.js'
     4	import type { SearchDiagnostics, SearchInput } from './keys.js'
     5	
     6	export interface IsmctsOptions {
     7	  seed: number
     8	  /** Both players' publicly declared 50-card lists — the same open-decklist assumption `determinise` documents. */
     9	  decks: [string[], string[]]
    10	  iterations?: number | undefined
    11	  rolloutCommandCap?: number | undefined
    12	  explorationC?: number | undefined
    13	}
    14	
    15	/** Every `CardId` a command names — the W4 guard `GreedyAgent` carries, for the same reason. */
    16	function commandCardIds(c: Command): readonly CardId[] {
    17	  switch (c.type) {
    18	    case 'castCharacter': case 'castSummon': return [c.card, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    19	    case 'declareAttack': return c.attackers
    20	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
    21	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
    22	    case 'discardToHandSize': return c.cards
    23	    case 'chooseTargets': return c.targets
    24	    case 'activateAbility': return [c.source, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
    25	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
    26	    default: { const _exhaustive: never = c; return _exhaustive }
    27	  }
    28	}
    29	
    30	/**
    31	 * The thin stateful wrapper (D-7). Everything that decides anything lives in `searchIsmcts`, which is pure and
    32	 * takes only a `PlayerView` plus the two declared lists — so D2 can move the search into a Web Worker by
    33	 * posting a `SearchInput` and this class keeps working unchanged.
    34	 *
    35	 * The only state here is the seed stream: the tree is rebuilt from scratch every `decide` (D-8), so nothing
    36	 * carries over between decisions and a replayed view trace replays exactly.
    37	 */
    38	export class IsmctsAgent implements Agent {
    39	  private rng: Rng
    40	  private readonly decks: [string[], string[]]
    41	  private readonly iterations: number
    42	  private readonly rolloutCommandCap: number
    43	  private readonly explorationC: number
    44	  readonly needsLegalCommands = false
    45	  /** Last decision's counters (spec D-A4). `null` before the first `decide`, and on the non-acting fallback. */
    46	  lastDiagnostics: SearchDiagnostics | null = null
    47	
    48	  constructor(opts: IsmctsOptions) {
    49	    this.rng = seedRng(opts.seed)
    50	    this.decks = opts.decks
    51	    this.iterations = opts.iterations ?? DEFAULT_ITERATIONS
    52	    this.rolloutCommandCap = opts.rolloutCommandCap ?? DEFAULT_ROLLOUT_COMMAND_CAP
    53	    this.explorationC = opts.explorationC ?? DEFAULT_EXPLORATION_C
    54	  }
    55	
    56	  decide(view: PlayerView, legal: Command[]): Command {
    57	    this.lastDiagnostics = null
    58	    const me = view.me
    59	    // The engine never asks a non-acting player to move; `legalCommands` for one returns `[concede]` alone, so
    60	    // there is nothing to search and `GreedyAgent`'s fallback is the same command by a longer route.
    61	    if ((view.pending?.player ?? view.priority) !== me || view.result) {
    62	      const fallback = legal[0]
    63	      return fallback ?? { type: 'concede', player: me }
    64	    }
    65	    // A fresh stream per decision, so decision N's search is not a function of how much work decision N-1 did.
    66	    const [seed, next] = nextInt(this.rng, 0x4000_0000)
    67	    this.rng = next
    68	    const input: SearchInput = {
    69	      view,
    70	      decks: this.decks,
    71	      iterations: this.iterations,
    72	      seed,
    73	      rolloutCommandCap: this.rolloutCommandCap,
    74	      explorationC: this.explorationC,
    75	    }
    76	    const { command, diagnostics } = searchIsmcts(input)
    77	    this.lastDiagnostics = diagnostics
    78	    // W4: a command that escaped with a determinisation's synthetic id would be illegal in the live game and,
    79	    // worse, would sometimes be *legal* while naming a card the search only imagined.
    80	    for (const id of commandCardIds(command)) {
    81	      if (id >= SYNTHETIC_ID_BASE) throw new Error(`IsmctsAgent.decide: chosen command ${command.type} references synthetic id ${id}`)
    82	    }
    83	    return command
    84	  }
    85	}

2026-08-27T09:23:55.410723Z ERROR codex_models_manager::manager: failed to renew cache TTL: missing field `base_instructions` at line 95 column 5
exec
/bin/zsh -lc "nl -ba packages/cards/src/abilities.ts | sed -n '1,180p'; nl -ba packages/cards/src/abilities.ts | sed -n '180,360p'; nl -ba packages/cards/src/abilities.ts | sed -n '360,500p'; rg -n '1-121C|16-092C|20-074C|19-052C|18-064C|18-069C' packages/cards/data/cards.json" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import type { Ability, CardDef, CardType } from '@fftcg/engine'
     2	
     3	/**
     4	 * The hand-written ability ASTs: the five rung-C1 clauses (spec C1-1/C1-10) plus C2's five (C2-12).
     5	 *
     6	 * WHY THIS FILE AND NOT `data/cards.json`: that file is FETCHED and regenerated by
     7	 * `scripts/fetch-cards.ts`, so anything hand-written in it is wiped by the next `pnpm --filter
     8	 * @fftcg/cards fetch`. The ASTs therefore live here, in source, and `loadCards()` merges them onto the
     9	 * fetched defs. `data/cards.json` stays purely machine-owned; `def.text` in it stays the printed wording
    10	 * that each `Ability.text` below is quoted from and that reviewers check the AST against.
    11	 *
    12	 * Every value here is a plain readonly record/array/string/number — no functions, `Map` or `Set` — because
    13	 * these ride on `CardDef`, and `CardDef` rides through `viewFor`/`determinise`'s `structuredClone` and
    14	 * `session.ts`'s serialisation (see the header of the engine's `abilities.ts`).
    15	 */
    16	
    17	// ---------------------------------------------------------------------------
    18	// Per-clause coverage (spec C1-9)
    19	// ---------------------------------------------------------------------------
    20	
    21	/**
    22	 * How many separate ability clauses each card PRINTS, whether or not any are implemented. Without this the
    23	 * engine falls back to `hasAbilities ? 1 : 0`, and a card with 1 of its 2 clauses implemented would report
    24	 * nothing missing — exactly the dishonest log C1-9 forbids.
    25	 *
    26	 * A clause is one ability, not one printed line: Shantotto and Ramuh each print their modes on their own
    27	 * lines but are a single modal clause, so they count 1. Cards whose two clauses are a static/continuous
    28	 * one plus an activated one (Odin, Sphene) count both.
    29	 */
    30	export const ABILITY_CLAUSES: Record<string, number> = {
    31	  '1-121C': 1,    // [Lightning][Dull]: grant Haste
    32	  '9-074C': 1,    // static: may produce Lightning CP
    33	  '12-120C': 1,   // ETB, modal — the two quoted actions are one clause
    34	  '13-072R': 2,   // static cost reduction | EX BURST break
    35	  '16-092C': 2,   // ETB dull up to 2 | [Dull], self-break: dull all
    36	  '18-064C': 1,   // [Earth], discard: draw 1
    37	  '18-069C': 1,   // [Lightning], discard: draw 1
    38	  '18-124C': 1,   // ETB return a Forward from the Break Zone
    39	  '19-052C': 2,   // self-break: +4000 | remove from game: +2000
    40	  '20-074C': 2,   // ETB reveal 5 | [2][Dull], self-break: draw 1
    41	  '20-103H': 1,   // Summon, modal — the three quoted actions are one clause
    42	  '20-105C': 1,   // EX BURST ETB look at top 3
    43	  '22-068R': 2,   // when chosen: +2000 (deferred, spec C2-13) | on damaging the opponent: Break Zone retrieval
    44	  '24-063H': 2,   // ETB search | when a cost-1 Forward enters your field
    45	  '27-124S': 2,   // ETB mass pump | at the beginning of the Attack Phase
    46	  '27-125S': 2,   // on damaging a Forward: break it | on damaging the opponent: modal — both C2, so 0 warnings
    47	  '27-126S': 2,   // static Break Zone protection | [0]: retrieve
    48	  '27-127S': 2,   // EX BURST ETB break | when an opponent's Forward is broken — both C2 stage 1, so 0 warnings
    49	}
    50	
    51	// ---------------------------------------------------------------------------
    52	// The five implemented clauses (spec C1-10)
    53	// ---------------------------------------------------------------------------
    54	
    55	/**
    56	 * Noel's ETB only. The `EX BURST` tag is quoted in `text` because that is the printed wording, but EX Burst
    57	 * itself is rung C3: this clause fires on a NORMAL cast, which is what `enterField` means. Noel's second
    58	 * clause (the [Dull] action ability) is C3 and keeps warning — hence `ABILITY_CLAUSES['16-092C'] === 2`.
    59	 *
    60	 * `min: 0` is "up to 2": declining is a legal answer, and the engine still raises the choice.
    61	 */
    62	const NOEL_ETB: Ability = {
    63	  id: '16-092C:etb',
    64	  trigger: { kind: 'enterField' },
    65	  text: 'EX BURST When Noel enters the field, choose up to 2 Forwards opponent controls. Dull them.',
    66	  effects: [{
    67	    kind: 'chooseTargets', min: 0, max: 2,
    68	    from: { zone: 'forwards', controller: 'opponent' },
    69	    then: [{ kind: 'dull' }],
    70	  }],
    71	}
    72	
    73	/**
    74	 * Shantotto's ETB: a mode choice whose chosen branch then raises a target choice — two `apply` calls, and
    75	 * the reason the agenda has a program counter at all (spec C1-3).
    76	 *
    77	 * Mode 1 is "other than Shantotto" (`excludeSource`) over EITHER player's Forwards — the printed text
    78	 * restricts the identity, not the controller. Mode 2 is "you control" (`controller: 'self'`) with no
    79	 * exclusion, so Shantotto may protect itself. `cannotBeBroken` is a flag, not a keyword: `granted` holds
    80	 * only real Keywords (spec C1-7).
    81	 */
    82	const SHANTOTTO_ETB: Ability = {
    83	  id: '12-120C:etb',
    84	  trigger: { kind: 'enterField' },
    85	  text: 'When Shantotto enters the field, select 1 of the 2 following actions.\n'
    86	    + '"Choose 1 Forward other than Shantotto. It gains Haste until the end of the turn."\n'
    87	    + '"Choose 1 Forward you control. It gains ‘This Forward cannot be broken’ until the end of the turn."',
    88	  effects: [{
    89	    kind: 'chooseModes', min: 1, max: 1,
    90	    modes: [
    91	      {
    92	        label: 'Choose 1 Forward other than Shantotto. It gains Haste until the end of the turn.',
    93	        effects: [{
    94	          kind: 'chooseTargets', min: 1, max: 1,
    95	          from: { zone: 'forwards', controller: 'any', filter: { excludeSource: true } },
    96	          then: [{ kind: 'grantKeyword', keyword: 'haste' }],
    97	        }],
    98	      },
    99	      {
   100	        label: 'Choose 1 Forward you control. It gains ‘This Forward cannot be broken’ until the end of the turn.',
   101	        effects: [{
   102	          kind: 'chooseTargets', min: 1, max: 1,
   103	          from: { zone: 'forwards', controller: 'self' },
   104	          then: [{ kind: 'grantFlag', flag: 'cannotBeBroken' }],
   105	        }],
   106	      },
   107	    ],
   108	  }],
   109	}
   110	
   111	/**
   112	 * Cloud's ETB only. Untargeted and unconditional, so it raises no prompt: `forEach` binds each of your
   113	 * Forwards in turn. Cloud is already on the field when its own ETB resolves, so it pumps itself too —
   114	 * that is the printed effect ("all the Forwards you control"), not an oversight.
   115	 *
   116	 * Cloud's second clause (at the beginning of the Attack Phase) needs a phase continuation and is C2; it
   117	 * keeps warning.
   118	 */
   119	const CLOUD_ETB: Ability = {
   120	  id: '27-124S:etb',
   121	  trigger: { kind: 'enterField' },
   122	  text: 'When Cloud enters the field, until the end of the turn, all the Forwards you control gain 3000 power and Brave.',
   123	  effects: [{
   124	    kind: 'forEach',
   125	    from: { zone: 'forwards', controller: 'self' },
   126	    do: [{ kind: 'addPower', amount: 3000 }, { kind: 'grantKeyword', keyword: 'brave' }],
   127	  }],
   128	}
   129	
   130	/**
   131	 * Billy Bob's ETB — the only Break-Zone-targeting clause in C1. "other than Card Name Billy Bob" excludes
   132	 * every card sharing the source's NAME (`excludeSourceName`), not just this instance: a second Billy Bob in
   133	 * the Break Zone is an illegal target too. The Break Zone holds Backups and Summons as well, hence the
   134	 * explicit `type: 'forward'` filter — `zone: 'breakZone'` alone does not imply one.
   135	 *
   136	 * `min: 1` with an empty Break Zone is a logged no-op, not an error (spec C1-7).
   137	 */
   138	const BILLY_BOB_ETB: Ability = {
   139	  id: '18-124C:etb',
   140	  trigger: { kind: 'enterField' },
   141	  text: 'When Billy Bob enters the field, choose 1 Forward other than Card Name Billy Bob in your Break Zone. Add it to your hand.',
   142	  effects: [{
   143	    kind: 'chooseTargets', min: 1, max: 1,
   144	    from: { zone: 'breakZone', controller: 'self', filter: { type: 'forward', excludeSourceName: true } },
   145	    then: [{ kind: 'moveToHand' }],
   146	  }],
   147	}
   148	
   149	/**
   150	 * Ramuh — the only `summonResolve` clause in the pool, and therefore the only exercise of the Summon
   151	 * resolution path. `min: 0` is "up to 2": selecting nothing is legal. Chosen modes resolve in PRINTED
   152	 * order regardless of the order they were picked in (the engine sorts the answer), each raising its own
   153	 * target choice in turn, so a two-mode answer costs three `apply` calls in total.
   154	 *
   155	 * "Choose 1 Forward" is unrestricted, so `controller: 'any'` — Ramuh can dull or burn your own Forward,
   156	 * and granting Haste to one of yours is the point of mode 3.
   157	 *
   158	 * By the time these resolve Ramuh is already in the Break Zone (no stack, §7.10.1 / spec C1-4);
   159	 * `Frame.source` is allowed to be a card that is not on the field.
   160	 */
   161	const RAMUH_SUMMON: Ability = {
   162	  id: '20-103H:summon',
   163	  trigger: { kind: 'summonResolve' },
   164	  text: 'Select up to 2 of the 3 following actions.\n'
   165	    + '"Choose 1 Forward. Dull it."\n'
   166	    + '"Choose 1 Forward. Deal it 5000 damage."\n'
   167	    + '"Choose 1 Forward. It gains Haste until the end of the turn."',
   168	  effects: [{
   169	    kind: 'chooseModes', min: 0, max: 2,
   170	    modes: [
   171	      {
   172	        label: 'Choose 1 Forward. Dull it.',
   173	        effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }],
   174	      },
   175	      {
   176	        label: 'Choose 1 Forward. Deal it 5000 damage.',
   177	        effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 5000 }] }],
   178	      },
   179	      {
   180	        label: 'Choose 1 Forward. It gains Haste until the end of the turn.',
   180	        label: 'Choose 1 Forward. It gains Haste until the end of the turn.',
   181	        effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'grantKeyword', keyword: 'haste' }] }],
   182	      },
   183	    ],
   184	  }],
   185	}
   186	
   187	// ---------------------------------------------------------------------------
   188	// The rung-C2 stage-1 clauses (spec C2-12)
   189	// ---------------------------------------------------------------------------
   190	
   191	/**
   192	 * Lightning's ETB. As with Noel, the `EX BURST` tag is quoted because it is printed, but EX Burst is a separate
   193	 * mechanic (C4) governing what happens when this card is taken as damage — the trigger below fires on a NORMAL
   194	 * cast, which is what `enterField` means. Lightning's two printed clauses are both implemented here, so it stops
   195	 * warning entirely (spec C2-A10).
   196	 *
   197	 * "of cost 4 or less" is `maxCost: 4` against the PRINTED cost; "opponent controls" is the target's controller.
   198	 */
   199	const LIGHTNING_ETB: Ability = {
   200	  id: '27-127S:etb',
   201	  trigger: { kind: 'enterField' },
   202	  text: 'EX BURST When Lightning enters the field, choose 1 Forward of cost 4 or less opponent controls. Break it.',
   203	  effects: [{
   204	    kind: 'chooseTargets', min: 1, max: 1,
   205	    from: { zone: 'forwards', controller: 'opponent', filter: { maxCost: 4 } },
   206	    then: [{ kind: 'breakCard' }],
   207	  }],
   208	}
   209	
   210	/**
   211	 * The rung's first OBSERVER trigger: the clause belongs to Lightning, but the event happens to a DIFFERENT card
   212	 * (spec C2-3/C2-4). `whose: 'opponent'` is relative to Lightning's own controller, never the turn player, so the
   213	 * clause means the same thing from either seat (spec C2-10).
   214	 *
   215	 * CR §11.8.6: two opponent Forwards broken at the same instant are two separate occurrences and this triggers
   216	 * twice — the engine collects one occurrence per (watcher, clause, transition), not one per batch.
   217	 */
   218	const LIGHTNING_OPPONENT_BROKEN: Ability = {
   219	  id: '27-127S:opponent-forward-broken',
   220	  trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
   221	  text: 'When a Forward opponent controls is put from the field into the Break Zone, choose 1 Forward you control. It gains Haste until the end of the turn.',
   222	  effects: [{
   223	    kind: 'chooseTargets', min: 1, max: 1,
   224	    from: { zone: 'forwards', controller: 'self' },
   225	    then: [{ kind: 'grantKeyword', keyword: 'haste' }],
   226	  }],
   227	}
   228	
   229	/**
   230	 * "Character" is Forward, Backup or Monster and never Summon (§7.2). A single `TargetFilter.type` cannot say that,
   231	 * which is why `types` exists (spec C2-9); both Break-Zone retrievals below are worded "1 Character".
   232	 */
   233	const CHARACTER: readonly CardType[] = ['forward', 'backup', 'monster']
   234	
   235	/**
   236	 * Luso's damage trigger, and the reason `Frame.triggerEvent` and `onSubject` exist (spec C2-5). "Break **it**"
   237	 * names the Forward Luso just damaged: it is NOT a `chooseTargets` over one candidate, because offering it as a
   238	 * choice would let the player decline or retarget a printed effect. `onSubject` binds the trigger event's
   239	 * subject and runs `breakCard` on it.
   240	 *
   241	 * Combat damage and ability damage both fire this — the text says "deals damage", not "deals combat damage"
   242	 * (spec C2-7). On LETHAL damage §12.4.5 has already broken the Forward by the time this resolves (spec C2-6),
   243	 * so the `breakCard` is a silent no-op and the card is in the Break Zone either way.
   244	 *
   245	 * Luso's second clause is `LUSO_DAMAGES_OPPONENT` below, so Luso warns about nothing at all (spec C2-A10).
   246	 */
   247	const LUSO_DAMAGES_FORWARD: Ability = {
   248	  id: '27-125S:damages-forward',
   249	  trigger: { kind: 'dealtDamage', to: 'forward', whose: 'any' },
   250	  text: 'When Luso deals damage to a Forward, break it.',
   251	  effects: [{ kind: 'onSubject', do: [{ kind: 'breakCard' }] }],
   252	}
   253	
   254	// ---------------------------------------------------------------------------
   255	// The rung-C2 stage-2 clauses (spec C2-12)
   256	// ---------------------------------------------------------------------------
   257	
   258	/**
   259	 * Luso's second clause — the hardest in the rung, because four things meet in it: a `dealtDamage` trigger on the
   260	 * PLAYER (which only fires reliably because party attribution is by membership, spec C2-8), a 0..2 modal choice,
   261	 * "1 Character" needing `types` (spec C2-9), and a mode that CASCADES into Luso's own first clause — the 3000
   262	 * damage makes Luso a damage source again, so `27-125S:damages-forward` queues behind this frame and breaks
   263	 * whatever §12.4.5 left standing. The cascade terminates: the damaged Forward leaves the field either way.
   264	 *
   265	 * "select up to 2 of the 2 following actions" is `min: 0, max: 2` — taking neither is a legal answer — and both
   266	 * chosen modes resolve in PRINTED order regardless of the order they were named (the engine sorts the answer).
   267	 * "Choose 1 Forward" is unrestricted, so `controller: 'any'`: Luso may burn one of its own side.
   268	 */
   269	const LUSO_DAMAGES_OPPONENT: Ability = {
   270	  id: '27-125S:damages-opponent',
   271	  trigger: { kind: 'dealtDamage', to: 'player', whose: 'opponent' },
   272	  text: 'When Luso deals damage to your opponent, select up to 2 of the 2 following actions. '
   273	    + '"Choose 1 Forward. Deal it 3000 damage." "Choose 1 Character in your Break Zone. Add it to your hand."',
   274	  effects: [{
   275	    kind: 'chooseModes', min: 0, max: 2,
   276	    modes: [
   277	      {
   278	        label: 'Choose 1 Forward. Deal it 3000 damage.',
   279	        effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'damage', amount: 3000 }] }],
   280	      },
   281	      {
   282	        label: 'Choose 1 Character in your Break Zone. Add it to your hand.',
   283	        effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'breakZone', controller: 'self', filter: { types: CHARACTER } }, then: [{ kind: 'moveToHand' }] }],
   284	      },
   285	    ],
   286	  }],
   287	}
   288	
   289	/**
   290	 * Prishe's second clause: the same player-damage trigger and the same "1 Character" retrieval as Luso's mode 2,
   291	 * without the modal wrapper. `min: 1` over a Break Zone holding no Character is a logged no-op (spec C1-7).
   292	 *
   293	 * Prishe's FIRST clause ("When Prishe is chosen by a Summon or an ability, …") is deliberately out of scope
   294	 * (spec C2-13): it would have to fire while a frame is already mid-flight choosing its targets, and the agenda
   295	 * cannot preempt an active frame — the one thing spec C2-A9 pins that it must never do. It keeps warning.
   296	 */
   297	const PRISHE_DAMAGES_OPPONENT: Ability = {
   298	  id: '22-068R:damages-opponent',
   299	  trigger: { kind: 'dealtDamage', to: 'player', whose: 'opponent' },
   300	  text: 'When Prishe deals damage to your opponent, choose 1 Character in your Break Zone. Add it to your hand.',
   301	  effects: [{
   302	    kind: 'chooseTargets', min: 1, max: 1,
   303	    from: { zone: 'breakZone', controller: 'self', filter: { types: CHARACTER } },
   304	    then: [{ kind: 'moveToHand' }],
   305	  }],
   306	}
   307	
   308	// ---------------------------------------------------------------------------
   309	// Activated abilities (spec C3)
   310	// ---------------------------------------------------------------------------
   311	
   312	/**
   313	 * The first abilities in this pool a PLAYER chooses to use rather than merely receives. `trigger.kind` is
   314	 * `'activated'` — not a trigger at all, but it lives in that union so trigger dispatch inertly ignores it and
   315	 * the compiler still checks every switch.
   316	 *
   317	 * Two things about the costs are easy to get wrong and are load-bearing here:
   318	 *
   319	 * - The CP cost is NOT the card's printed cost. Red Mage 1-121C costs 2 to cast and its ability costs
   320	 *   `[Lightning]` — one CP, Lightning. Miner costs 3 to cast and its ability costs a generic `[2]`.
   321	 * - `dull: true` is what brings the "must be active, and not the turn it entered unless it has Haste" rule
   322	 *   (§11.6.2.2). Undead Princess has no dull icon, so she may be used while dulled and on the turn she
   323	 *   arrives — she is the fixture that keeps that gate honest.
   324	 */
   325	const RED_MAGE_HASTE: Ability = {
   326	  id: '1-121C:haste',
   327	  trigger: {
   328	    kind: 'activated', sourceZone: 'field',
   329	    // The source may not dull ITSELF to make this Lightning CP — that one dull would otherwise pay both the
   330	    // CP and the [Dull]. `generateCp` excludes it (spec C3-5).
   331	    cost: { cp: { amount: 1, requiredElements: ['lightning'] }, dull: true },
   332	  },
   333	  text: '[Lightning][Dull]: Choose 1 Forward. It gains Haste until the end of the turn.',
   334	  effects: [{
   335	    kind: 'chooseTargets', min: 1, max: 1,
   336	    // "Choose 1 Forward" — either player's, unrestricted. Granting the OPPONENT Haste is legal and useless,
   337	    // which is the printed text's business, not the engine's.
   338	    from: { zone: 'forwards', controller: 'any' },
   339	    then: [{ kind: 'grantKeyword', keyword: 'haste' }],
   340	  }],
   341	}
   342	
   343	/**
   344	 * Noel's action. Its cost dulls AND removes its own source, so by the time "dull all the Forwards opponent
   345	 * controls" resolves, Noel is in the Break Zone — the effect must still resolve in full (spec C3-A2).
   346	 * `forEach` is untargeted: "all" is not a choice.
   347	 */
   348	const NOEL_DULL_ALL: Ability = {
   349	  id: '16-092C:dull-all',
   350	  trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true, selfToBreakZone: true } },
   351	  text: '[Dull], put Noel into the Break Zone: Dull all the Forwards opponent controls.',
   352	  effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'dull' }] }],
   353	}
   354	
   355	/**
   356	 * Miner's action. Miner's OTHER printed clause — the ETB deck reveal — is rung C6, so this is the card's
   357	 * second printed clause arriving first. That is exactly why commands carry `abilityId` and not an index into
   358	 * this array (spec C3-2): an index would silently shift when the ETB lands.
   359	 */
   360	const MINER_DRAW: Ability = {
   360	const MINER_DRAW: Ability = {
   361	  id: '20-074C:draw',
   362	  trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 2 }, dull: true, selfToBreakZone: true } },
   363	  text: '[2][Dull], put Miner into the Break Zone: Draw 1 card.',
   364	  effects: [{ kind: 'draw', count: 1 }],
   365	}
   366	
   367	/**
   368	 * Undead Princess's first clause. No dull icon and no CP: the entire cost is putting herself into the Break
   369	 * Zone, which makes her the fixture for two rules at once — that the `[Dull]` restrictions do NOT apply
   370	 * without the icon, and that a target preflight runs against the POST-cost state. She has already left the
   371	 * field when targets are computed, so she cannot pump herself, and if she is the only Forward the activation
   372	 * is illegal rather than a cost paid for nothing (§11.6.5).
   373	 */
   374	const UNDEAD_PRINCESS_PUMP: Ability = {
   375	  id: '19-052C:pump',
   376	  trigger: { kind: 'activated', sourceZone: 'field', cost: { selfToBreakZone: true } },
   377	  text: 'Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.',
   378	  effects: [{
   379	    kind: 'chooseTargets', min: 1, max: 1,
   380	    from: { zone: 'forwards', controller: 'any' },
   381	    then: [{ kind: 'addPower', amount: 4000 }],
   382	  }],
   383	}
   384	
   385	/**
   386	 * The two hand-sourced draws. `sourceZone: 'hand'` is what encodes "You can only use this ability if <card>
   387	 * is in your hand" — an activation precondition, not a cost (spec C3-3). They are otherwise identical, and
   388	 * they exist in this rung to prove the source zone is real rather than assumed to be the field.
   389	 */
   390	const GEOMANCER_DRAW: Ability = {
   391	  id: '18-064C:draw',
   392	  trigger: {
   393	    kind: 'activated', sourceZone: 'hand',
   394	    cost: { cp: { amount: 1, requiredElements: ['earth'] }, selfDiscard: true },
   395	  },
   396	  text: '[Earth], discard Geomancer: Draw 1 card. You can only use this ability if Geomancer is in your hand.',
   397	  effects: [{ kind: 'draw', count: 1 }],
   398	}
   399	
   400	const RED_MAGE_18_DRAW: Ability = {
   401	  id: '18-069C:draw',
   402	  trigger: {
   403	    kind: 'activated', sourceZone: 'hand',
   404	    cost: { cp: { amount: 1, requiredElements: ['lightning'] }, selfDiscard: true },
   405	  },
   406	  text: '[Lightning], discard Red Mage: Draw 1 card. You can only use this ability if Red Mage is in your hand.',
   407	  effects: [{ kind: 'draw', count: 1 }],
   408	}
   409	
   410	/** Implemented clauses by card code. A card absent from here has none — every clause it prints still warns. */
   411	export const ABILITIES: Record<string, readonly Ability[]> = {
   412	  '1-121C': [RED_MAGE_HASTE],
   413	  '12-120C': [SHANTOTTO_ETB],
   414	  // Printed order: the ETB is clause 1, the action clause 2.
   415	  '16-092C': [NOEL_ETB, NOEL_DULL_ALL],
   416	  '18-064C': [GEOMANCER_DRAW],
   417	  '18-069C': [RED_MAGE_18_DRAW],
   418	  '18-124C': [BILLY_BOB_ETB],
   419	  // Clause 1 only; the "remove from the Break Zone from the game" clause is C4.
   420	  '19-052C': [UNDEAD_PRINCESS_PUMP],
   421	  // The card's SECOND printed clause, landing first — its ETB deck reveal is C6.
   422	  '20-074C': [MINER_DRAW],
   423	  '20-103H': [RAMUH_SUMMON],
   424	  '22-068R': [PRISHE_DAMAGES_OPPONENT],
   425	  '27-124S': [CLOUD_ETB],
   426	  '27-125S': [LUSO_DAMAGES_FORWARD, LUSO_DAMAGES_OPPONENT],
   427	  '27-127S': [LIGHTNING_ETB, LIGHTNING_OPPONENT_BROKEN],
   428	}
   429	
   430	/**
   431	 * Merge the hand-written ASTs and clause counts onto fetched defs. Pure and free of `node:fs`, so the web
   432	 * app — which imports `data/cards.json` directly because the package index reads the file with `node:fs`
   433	 * (see `apps/web/src/deck.ts`) — can call this and play the SAME ability game the CLI does.
   434	 */
   435	export function withAbilities(defs: readonly CardDef[]): CardDef[] {
   436	  return defs.map((def) => {
   437	    const abilities = ABILITIES[def.code]
   438	    const clauses = ABILITY_CLAUSES[def.code]
   439	    return {
   440	      ...def,
   441	      ...(abilities ? { abilities } : {}),
   442	      ...(clauses === undefined ? {} : { abilityClauses: clauses }),
   443	    }
   444	  })
   445	}
3:    "code": "1-121C",
64:    "code": "16-092C",
79:    "code": "18-064C",
94:    "code": "18-069C",
125:    "code": "19-052C",
140:    "code": "20-074C",

2026-08-27T09:24:01.679485Z ERROR codex_models_manager::manager: failed to renew cache TTL: missing field `base_instructions` at line 95 column 5
exec
/bin/zsh -lc "nl -ba packages/cards/data/cards.json | sed -n '1,20p'; nl -ba packages/cards/data/cards.json | sed -n '60,112p'; nl -ba packages/cards/data/cards.json | sed -n '120,158p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	[
     2	  {
     3	    "code": "1-121C",
     4	    "name": "Red Mage",
     5	    "type": "backup",
     6	    "elements": [
     7	      "lightning"
     8	    ],
     9	    "cost": 2,
    10	    "power": null,
    11	    "keywords": [],
    12	    "generic": true,
    13	    "exBurst": false,
    14	    "text": "[Lightning][Dull]: Choose 1 Forward. It gains Haste until the end of the turn.",
    15	    "hasAbilities": true
    16	  },
    17	  {
    18	    "code": "9-074C",
    19	    "name": "Class Tenth Moogle",
    20	    "type": "backup",
    60	    "text": "If you have received 5 points of damage or more, the cost required to cast Odin is reduced by 3.\nEX BURST Choose 1 Forward of cost 5 or less. Break it.",
    61	    "hasAbilities": true
    62	  },
    63	  {
    64	    "code": "16-092C",
    65	    "name": "Noel",
    66	    "type": "forward",
    67	    "elements": [
    68	      "lightning"
    69	    ],
    70	    "cost": 5,
    71	    "power": 9000,
    72	    "keywords": [],
    73	    "generic": false,
    74	    "exBurst": true,
    75	    "text": "EX BURST When Noel enters the field, choose up to 2 Forwards opponent controls. Dull them.\n[Dull], put Noel into the Break Zone: Dull all the Forwards opponent controls.",
    76	    "hasAbilities": true
    77	  },
    78	  {
    79	    "code": "18-064C",
    80	    "name": "Geomancer",
    81	    "type": "backup",
    82	    "elements": [
    83	      "earth"
    84	    ],
    85	    "cost": 1,
    86	    "power": null,
    87	    "keywords": [],
    88	    "generic": true,
    89	    "exBurst": false,
    90	    "text": "[Earth], discard Geomancer: Draw 1 card. You can only use this ability if Geomancer is in your hand.",
    91	    "hasAbilities": true
    92	  },
    93	  {
    94	    "code": "18-069C",
    95	    "name": "Red Mage",
    96	    "type": "backup",
    97	    "elements": [
    98	      "lightning"
    99	    ],
   100	    "cost": 1,
   101	    "power": null,
   102	    "keywords": [],
   103	    "generic": true,
   104	    "exBurst": false,
   105	    "text": "[Lightning], discard Red Mage: Draw 1 card. You can only use this ability if Red Mage is in your hand.",
   106	    "hasAbilities": true
   107	  },
   108	  {
   109	    "code": "18-124C",
   110	    "name": "Billy Bob",
   111	    "type": "forward",
   112	    "elements": [
   120	    "exBurst": false,
   121	    "text": "When Billy Bob enters the field, choose 1 Forward other than Card Name Billy Bob in your Break Zone. Add it to your hand.",
   122	    "hasAbilities": true
   123	  },
   124	  {
   125	    "code": "19-052C",
   126	    "name": "Undead Princess",
   127	    "type": "forward",
   128	    "elements": [
   129	      "earth"
   130	    ],
   131	    "cost": 1,
   132	    "power": 2000,
   133	    "keywords": [],
   134	    "generic": false,
   135	    "exBurst": false,
   136	    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
   137	    "hasAbilities": true
   138	  },
   139	  {
   140	    "code": "20-074C",
   141	    "name": "Miner",
   142	    "type": "backup",
   143	    "elements": [
   144	      "earth"
   145	    ],
   146	    "cost": 3,
   147	    "power": null,
   148	    "keywords": [],
   149	    "generic": true,
   150	    "exBurst": false,
   151	    "text": "When Miner enters the field, reveal the top 5 cards of your deck. Add 1 Backup among them to your hand and return the other cards to the bottom of your deck in any order.\n[2][Dull], put Miner into the Break Zone: Draw 1 card.",
   152	    "hasAbilities": true
   153	  },
   154	  {
   155	    "code": "20-103H",
   156	    "name": "Ramuh",
   157	    "type": "summon",
   158	    "elements": [

exec
/bin/zsh -lc "nl -ba apps/web/src/game/commands.ts | sed -n '1,180p'; nl -ba apps/web/src/game/commands.ts | sed -n '180,360p'; nl -ba apps/web/src/game/commands.ts | sed -n '360,520p'; nl -ba apps/web/src/game/useGame.ts | sed -n '40,125p'; nl -ba apps/cli/src/render.ts | sed -n '1,180p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import {
     2	  HAND_SIZE_LIMIT, abilityCpRequirement, describeAbilityCost, effectivePower, seedRng,
     3	  type Ability, type CardDef, type CardId, type Command, type Effect, type FieldCard, type FieldFlag, type Frame,
     4	  type GameState, type Keyword, type Payment, type Pending, type PlayerId, type PlayerState, type PlayerView,
     5	  type ZoneTransitionReason,
     6	} from '@fftcg/engine'
     7	import { preferredPayment, preferredPaymentFor } from '@fftcg/ai'
     8	import type { Choice, ChoiceSet } from './types.js'
     9	
    10	const PHASE_LABEL: Record<string, string> = {
    11	  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
    12	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
    13	}
    14	
    15	const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
    16	const FLAG_PURPOSE: Record<FieldFlag, string> = { cannotBeBroken: 'to protect from being broken' }
    17	const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)
    18	const only = <T,>(s: Set<T>): T | null => (s.size === 1 ? ([...s][0] as T) : null)
    19	
    20	function defFor(v: PlayerView, id: CardId): CardDef | undefined {
    21	  const code = v.cards[id]?.code
    22	  return code === undefined ? undefined : v.defs[code]
    23	}
    24	
    25	/** Card names only — the board already shows the art and the id, so the CLI's `Name (CODE)` is noise in a GUI. */
    26	function name(v: PlayerView, id: CardId): string {
    27	  return defFor(v, id)?.name ?? v.cards[id]?.code ?? `#${id}`
    28	}
    29	
    30	/** "A", "A and B", "A, B and C" — target sets are read aloud off a button, so a bare comma list reads badly. */
    31	function listNames(v: PlayerView, ids: readonly CardId[]): string {
    32	  const names = ids.map((id) => name(v, id))
    33	  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
    34	}
    35	
    36	/** The printed wording of mode `i`, from the `chooseMode` pending the command answers. */
    37	const modeLabel = (v: PlayerView, i: number): string => (v.pending?.kind === 'chooseMode' ? v.pending.labels[i] ?? `mode ${i + 1}` : `mode ${i + 1}`)
    38	
    39	// ---------------------------------------------------------------------------
    40	// Why a clause fired (rung C2)
    41	// ---------------------------------------------------------------------------
    42	
    43	/**
    44	 * The part of a `TriggerEvent` narration reads. A structural SUBSET of the engine's type, so a real
    45	 * `Frame.triggerEvent` is assignable to it (spec C2-5) — while the log, which reconstructs a cause from the
    46	 * event stream, is not forced to invent the fields it cannot know (`sourceController`, `from`/`to`, `owner`).
    47	 */
    48	export type TriggerCause =
    49	  | { readonly kind: 'damage'; readonly source: CardId; readonly target: CardId | null; readonly victim: PlayerId | null; readonly amount: number }
    50	  /**
    51	   * `reason` is optional because the log RECONSTRUCTS causes from the event stream and cannot always know
    52	   * one; absent, it means the ordinary case (the card was broken). `Frame.triggerEvent` always carries it.
    53	   */
    54	  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly controller: PlayerId; readonly reason?: ZoneTransitionReason }
    55	
    56	const possessive = (v: PlayerView, p: PlayerId): string => (p === v.me ? 'your' : "the AI's")
    57	
    58	/**
    59	 * WHY a clause fired, as a phrase (spec C2-5). This is the whole point of C2's narration: an observer trigger
    60	 * belongs to a card the event did NOT happen to — Lightning's clause fires because a different Forward was
    61	 * broken — so "Lightning's ability triggers" alone leaves the player with no way to connect the prompt in
    62	 * front of them to the board. Lower-case initial: it is used both mid-sentence in the log and, capitalised,
    63	 * at the head of a prompt.
    64	 */
    65	export function describeTriggerCause(v: PlayerView, ev: TriggerCause): string {
    66	  // Not every trip to the Break Zone is a break. A card put there to PAY for its own ability was not broken
    67	  // (§15.1.1.3.2), and reporting it as one would tell the player something about the board that is false —
    68	  // it also reads as though their own card had been destroyed by the opponent.
    69	  if (ev.kind === 'zoneChange') {
    70	    const how = ev.reason === 'cost' ? 'was put into the Break Zone' : 'was broken'
    71	    return `${possessive(v, ev.controller)} ${name(v, ev.card)} ${how}`
    72	  }
    73	  if (ev.victim !== null) return `${name(v, ev.source)} dealt damage to ${ev.victim === v.me ? 'you' : 'the AI'}`
    74	  return `${name(v, ev.source)} dealt ${ev.amount} damage to ${ev.target === null ? 'a Forward' : name(v, ev.target)}`
    75	}
    76	
    77	const capitalise = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`
    78	
    79	// ---------------------------------------------------------------------------
    80	// Ability wording (rung C1)
    81	// ---------------------------------------------------------------------------
    82	
    83	/**
    84	 * The clause the agenda is suspended on. It is readable from the view alone because the AST rides on `CardDef`
    85	 * and `viewFor` already carries `defs` (spec C1-2) — the UI needs no new channel to say what a choice is FOR.
    86	 * The source may sit in the Break Zone rather than on the field: a Summon resolves from there (spec C1-10).
    87	 */
    88	function activeAbility(v: PlayerView): { ability: Ability; frame: Frame } | null {
    89	  const frame = v.resolution.active
    90	  if (!frame) return null
    91	  const ability = defFor(v, frame.source)?.abilities?.find((a) => a.id === frame.abilityId)
    92	  return ability ? { ability, frame } : null
    93	}
    94	
    95	/** Prefix a prompt with the card that is asking, e.g. `Noel: choose up to 2 …`. */
    96	function sourced(v: PlayerView, text: string): string {
    97	  const active = activeAbility(v)
    98	  return active ? `${name(v, active.frame.source)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
    99	}
   100	
   101	/**
   102	 * Lead an ability prompt with what it is REACTING to, read straight off the frame the agenda is suspended on
   103	 * (spec C2-5) — the authority, not a reconstruction. Cause first, then the ask: "The AI's Prishe was broken —
   104	 * Lightning: choose 1 Forward you control to give Haste" says why the prompt appeared before it says what to
   105	 * do. The dash is reserved for this: the strip's own trailing "click a highlighted card" hint uses "·".
   106	 * Empty for `enterField`/`summonResolve`, which are about the source itself and need no explaining.
   107	 */
   108	function caused(v: PlayerView, text: string): string {
   109	  const ev = v.resolution.active?.triggerEvent
   110	  return ev ? `${capitalise(describeTriggerCause(v, ev))} — ${text}` : text
   111	}
   112	
   113	/**
   114	 * The effect node `path` points at, mirroring `effectAt` in the engine's resolve.ts. Duplicated rather than
   115	 * imported because the engine keeps it private, and the cost of drift is bounded: this drives WORDING only,
   116	 * and every caller falls back to neutral phrasing when it returns null.
   117	 */
   118	function nodeAt(effects: readonly Effect[], path: readonly number[], modes: readonly number[], depth: number): Effect | null {
   119	  const i = path[depth]
   120	  if (i === undefined) return null
   121	  const eff = effects[i]
   122	  if (!eff) return null
   123	  if (depth === path.length - 1) return eff
   124	  if (eff.kind === 'chooseTargets') return nodeAt(eff.then, path, modes, depth + 1)
   125	  if (eff.kind === 'chooseModes') {
   126	    // `chooseModes` owns two levels: the ordinal of the chosen mode, then the effect index inside it.
   127	    const k = path[depth + 1]
   128	    if (k === undefined) return null
   129	    const mode = eff.modes[modes[k] ?? -1]
   130	    return mode ? nodeAt(mode.effects, path, modes, depth + 2) : null
   131	  }
   132	  return null
   133	}
   134	
   135	/**
   136	 * What a clause does to the cards it picks, as an imperative for the button ("Dull") and a purpose clause for
   137	 * the prompt ("to dull"). Read off the AST rather than hard-coded per card, so a clause the cards lane adds
   138	 * tomorrow gets a real label with no change here.
   139	 */
   140	function verbOf(e: Effect): { imperative: string; purpose: string } | null {
   141	  switch (e.kind) {
   142	    case 'dull': return { imperative: 'Dull', purpose: 'to dull' }
   143	    case 'damage': return { imperative: `Deal ${e.amount} damage to`, purpose: `to deal ${e.amount} damage to` }
   144	    case 'breakCard': return { imperative: 'Break', purpose: 'to break' }
   145	    case 'addPower': return { imperative: `Give ${signed(e.amount)} power to`, purpose: `to give ${signed(e.amount)} power` }
   146	    case 'grantKeyword': return { imperative: `Give ${KEYWORD_LABEL[e.keyword]} to`, purpose: `to give ${KEYWORD_LABEL[e.keyword]}` }
   147	    case 'grantFlag': return { imperative: 'Protect', purpose: FLAG_PURPOSE[e.flag] }
   148	    case 'moveToHand': return { imperative: 'Return', purpose: 'to return to hand' }
   149	    // chooseTargets/chooseModes/forEach describe a choice of their own, not what THIS one does to its picks.
   150	    default: return null
   151	  }
   152	}
   153	
   154	/**
   155	 * The verb for the `chooseTargets` node the pending projects. The program counter names it exactly; a whole-AST
   156	 * scan is the fallback for a frame whose path cannot be followed, and it only speaks when the match is
   157	 * unambiguous — Shantotto and Ramuh both print several `1 Forward` clauses, so guessing between them would put
   158	 * the wrong verb on the button.
   159	 */
   160	function targetVerb(v: PlayerView, pending: Extract<Pending, { kind: 'chooseTargets' }>): { imperative: string; purpose: string } | null {
   161	  const active = activeAbility(v)
   162	  if (!active) return null
   163	  const found: Extract<Effect, { kind: 'chooseTargets' }>[] = []
   164	  const walk = (effects: readonly Effect[]): void => {
   165	    for (const e of effects) {
   166	      if (e.kind === 'chooseTargets') {
   167	        // `pending.max` is already clamped to the candidate count, so the node's printed max can only be larger.
   168	        if (e.min === pending.min && e.max >= pending.max) found.push(e)
   169	        walk(e.then)
   170	      } else if (e.kind === 'chooseModes') for (const m of e.modes) walk(m.effects)
   171	      else if (e.kind === 'forEach') walk(e.do)
   172	    }
   173	  }
   174	  const exact = nodeAt(active.ability.effects, active.frame.path, active.frame.modes, 0)
   175	  let node: Extract<Effect, { kind: 'chooseTargets' }> | null = exact?.kind === 'chooseTargets' ? exact : null
   176	  if (!node) { walk(active.ability.effects); node = found.length === 1 ? found[0] ?? null : null }
   177	  if (!node) return null
   178	  for (const e of node.then) { const w = verbOf(e); if (w) return w }
   179	  return null
   180	}
   180	}
   181	
   182	type Where = { p: PlayerId; zone: 'forwards' | 'backups' | 'breakZone' }
   183	function whereIs(v: PlayerView, id: CardId): Where | null {
   184	  for (const p of [0, 1] as const) {
   185	    const f = v.fields[p]
   186	    if (f.forwards.some((c) => c.id === id)) return { p, zone: 'forwards' }
   187	    if (f.backups.some((c) => c.id === id)) return { p, zone: 'backups' }
   188	    if (f.breakZone.includes(id)) return { p, zone: 'breakZone' }
   189	  }
   190	  return null
   191	}
   192	
   193	/**
   194	 * What the legal candidates ARE, in English: "Forwards the AI controls", "cards in your Break Zone". Derived
   195	 * from where the candidates actually sit rather than from the clause's `TargetSpec`, so it describes the set
   196	 * the player can really click even when the filter narrowed it further.
   197	 */
   198	function candidateNoun(v: PlayerView, ids: readonly CardId[], plural: boolean): string {
   199	  const spots = ids.map((id) => whereIs(v, id))
   200	  const zone = only(new Set(spots.map((s) => s?.zone ?? null)))
   201	  const seat = only(new Set(spots.map((s) => s?.p ?? null)))
   202	  if (zone === 'breakZone') return `${plural ? 'cards' : 'card'} in ${seat === null ? 'a' : seat === v.me ? 'your' : "the AI's"} Break Zone`
   203	  const noun = zone === 'forwards' ? (plural ? 'Forwards' : 'Forward')
   204	    : zone === 'backups' ? (plural ? 'Backups' : 'Backup')
   205	    : plural ? 'cards' : 'card'
   206	  if (seat === null || zone === null) return noun
   207	  return `${noun} ${seat === v.me ? 'you control' : 'the AI controls'}`
   208	}
   209	
   210	/** How many, as the printed wording says it: an exact count, or "up to N" for a `min` of 0 (spec C1-10). */
   211	const countPhrase = (min: number, max: number): string => (min === max ? `${max}` : `up to ${max}`)
   212	
   213	/** Everything the board must SHOW about a field card. */
   214	export interface FieldCardDisplay {
   215	  /**
   216	   * EFFECTIVE power (spec C1-7), or null for anything with no printed power. Printed power becomes a lie the
   217	   * moment a clause pumps a Forward, and the card's remaining power, its damage bar and its accessibility
   218	   * label are all computed from whatever number goes in here.
   219	   */
   220	  power: number | null
   221	  powerBonus: number
   222	  granted: readonly Keyword[]
   223	  flags: readonly FieldFlag[]
   224	}
   225	
   226	export function fieldCardDisplay(v: PlayerView, c: FieldCard): FieldCardDisplay {
   227	  const def = defFor(v, c.id)
   228	  return {
   229	    power: def && def.power !== null ? effectivePower(def, c) : null,
   230	    powerBonus: c.powerBonus,
   231	    granted: c.granted,
   232	    flags: c.flags,
   233	  }
   234	}
   235	
   236	/** English label for one command, from the acting player's point of view. Ported from `apps/cli/src/render.ts`. */
   237	export function describeChoice(v: PlayerView, c: Command): string {
   238	  switch (c.type) {
   239	    case 'chooseFirst': return c.goFirst ? 'Take the first turn' : 'Let the opponent go first'
   240	    case 'mulligan': return c.redraw ? 'Mulligan (redraw 5)' : 'Keep hand'
   241	    case 'castCharacter':
   242	    case 'castSummon': {
   243	      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
   244	      return pay.length ? `Cast ${name(v, c.card)} paying: ${pay.join(', ')}` : `Cast ${name(v, c.card)} (free)`
   245	    }
   246	    /*
   247	     * `legalCommands` pre-enumerates whole target SETS — one command per legal combination of `min..max`
   248	     * candidates — so "up to 2" reaches the UI as a list of finished answers, not an incremental
   249	     * pick-then-confirm. C1 accepts that (spec C1-6 flagged the combinatorics); what it costs is that the
   250	     * label has to carry the entire set, so it names the effect too and the button states what the click does.
   251	     */
   252	    case 'chooseTargets': {
   253	      if (!c.targets.length) return 'Choose no targets'
   254	      const verb = v.pending?.kind === 'chooseTargets' ? targetVerb(v, v.pending) : null
   255	      return `${verb?.imperative ?? 'Target'} ${listNames(v, c.targets)}`
   256	    }
   257	    // A mode has no card subject, so its button IS the printed wording — never a paraphrase of it.
   258	    case 'chooseMode': return c.modes.length ? c.modes.map((i) => modeLabel(v, i)).join(' + ') : 'None of these'
   259	    // The printed cost is part of the label: a player choosing to spend a card needs to see what it costs
   260	    // before clicking, not after (spec C3-A7).
   261	    case 'activateAbility': {
   262	      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
   263	      const cost = activatedCostOf(v, c.source, c.abilityId)
   264	      return `${cost}: ${name(v, c.source)}${pay.length ? ` — paying ${pay.join(', ')}` : ''}`
   265	    }
   266	    case 'declareAttack': return `Attack with ${c.attackers.map((id) => name(v, id)).join(' + ')}`
   267	    case 'declareBlock': return c.blocker === null ? "Don't block" : `Block with ${name(v, c.blocker)}`
   268	    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${name(v, a.target)}`).join(', ')}`
   269	    case 'discardToHandSize': return `Discard ${c.cards.map((id) => name(v, id)).join(', ')}`
   270	    case 'pass': return 'Pass'
   271	    case 'concede': return 'Concede'
   272	  }
   273	}
   274	
   275	/** Mirrors `legalCommands`/`actingPlayer` against the view: `pending` outranks `priority` (see engine `legal.ts`). */
   276	function actingIn(v: PlayerView): PlayerId | null {
   277	  if (v.result) return null
   278	  return v.pending?.player ?? v.priority
   279	}
   280	
   281	/** One line stating what the game is waiting for, derived from `pending` first, then `phase`/`attack.step`. */
   282	export function promptFor(v: PlayerView): string {
   283	  if (v.result) return v.result.winner === null ? 'Game over — a draw' : v.result.winner === v.me ? 'Game over — you win' : 'Game over — the AI wins'
   284	  if (actingIn(v) !== v.me) return 'Waiting for the opponent…'
   285	  if (v.pending) {
   286	    switch (v.pending.kind) {
   287	      case 'chooseFirst': return 'Choose who goes first'
   288	      case 'mulligan': return 'Keep your hand or mulligan'
   289	      case 'discardToHandSize': return `Discard down to ${HAND_SIZE_LIMIT} cards`
   290	      case 'declareBlock': return 'Choose a blocker'
   291	      case 'assignPartyDamage': return 'Assign combat damage'
   292	      // Both ability prompts name the card that is asking and what the choice is FOR — "choose 2 targets" tells
   293	      // the player nothing they can act on. The wording is derived from the clause's own AST, never hard-coded.
   294	      case 'chooseTargets': {
   295	        const { min, max, candidates } = v.pending
   296	        const purpose = targetVerb(v, v.pending)?.purpose
   297	        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} ${candidateNoun(v, candidates, max !== 1)}${purpose ? ` ${purpose}` : ''}`))
   298	      }
   299	      case 'chooseMode': {
   300	        const { min, max, labels } = v.pending
   301	        return caused(v, sourced(v, `Choose ${countPhrase(min, max)} of the ${labels.length} following effect${labels.length === 1 ? '' : 's'}`))
   302	      }
   303	    }
   304	  }
   305	  switch (v.phase) {
   306	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
   307	    case 'main2': return 'Main Phase 2 — cast or pass'
   308	    case 'attack': return v.attack?.step === 'declaration' ? 'Attack Phase — declare an attack or pass' : `Attack Phase — ${v.attack?.step ?? 'resolving'}`
   309	    default: return `${PHASE_LABEL[v.phase] ?? v.phase} — nothing to do`
   310	  }
   311	}
   312	
   313	/** Every card a command acts on. Order matters: the first is the click-target `Choice.card` hangs off. */
   314	function subjectsOf(c: Command): CardId[] {
   315	  switch (c.type) {
   316	    case 'castCharacter':
   317	    case 'castSummon': return [c.card]
   318	    case 'declareAttack': return c.attackers
   319	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
   320	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
   321	    case 'discardToHandSize': return c.cards
   322	    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
   323	    // legal candidates and nothing else — clicking one is how the set gets picked.
   324	    case 'chooseTargets': return [...c.targets]
   325	    // An activation is an action taken BY a card, so its subject is the source — clicking the card is how you
   326	    // use it. The CP sources are deliberately not subjects: they are payment, chosen for you.
   327	    case 'activateAbility': return [c.source]
   328	    // `chooseMode` has no card subject at all: its options are printed wordings, so they are strip buttons.
   329	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
   330	    default: { const _exhaustive: never = c; return _exhaustive }
   331	  }
   332	}
   333	
   334	/**
   335	 * Group `legal` into the click map the board renders from. Spec B-A4: a card is clickable IFF it is a key of
   336	 * `byCard`, so an illegal click is unrepresentable rather than rejected after the fact. A command with several
   337	 * subjects (a multi-forward attack party, a damage split, a multi-card discard) is listed under *every* one of
   338	 * them — clicking any member of a party has to offer that party — while `Choice.card`, which is singular, keeps
   339	 * the first as the label's anchor.
   340	 */
   341	export function buildChoiceSet(v: PlayerView, legal: Command[]): ChoiceSet {
   342	  const all: Choice[] = []
   343	  const byCard = new Map<CardId, Choice[]>()
   344	  const loose: Choice[] = []
   345	  for (const command of legal) {
   346	    const subjects = subjectsOf(command)
   347	    const choice: Choice = { command, label: describeChoice(v, command), card: subjects[0] ?? null }
   348	    all.push(choice)
   349	    if (!subjects.length) { loose.push(choice); continue }
   350	    for (const id of subjects) byCard.set(id, [...(byCard.get(id) ?? []), choice])
   351	  }
   352	  return { all, byCard, loose, prompt: promptFor(v) }
   353	}
   354	
   355	function sameIds(a: readonly CardId[], b: readonly CardId[]): boolean {
   356	  if (a.length !== b.length) return false
   357	  const sortedB = [...b].sort((x, y) => x - y)
   358	  return [...a].sort((x, y) => x - y).every((id, i) => id === sortedB[i])
   359	}
   360	
   360	
   361	/** Payments are sets of sources, not sequences — `legalCommands` and `preferredPayment` build them in different orders. */
   362	export function samePayment(a: Payment, b: Payment): boolean {
   363	  if (!sameIds(a.dullBackups, b.dullBackups)) return false
   364	  if (a.discards.length !== b.discards.length) return false
   365	  const key = (d: Payment['discards'][number]) => `${d.card}:${d.element}`
   366	  const bKeys = b.discards.map(key).sort()
   367	  return a.discards.map(key).sort().every((k, i) => k === bKeys[i])
   368	}
   369	
   370	/** Structural equality, used by `useGame.choose` to prove a command is in the current legal set before applying. */
   371	export function sameCommand(a: Command, b: Command): boolean {
   372	  if (a.type !== b.type || a.player !== b.player) return false
   373	  switch (a.type) {
   374	    case 'chooseFirst': return a.goFirst === (b as typeof a).goFirst
   375	    case 'mulligan': return a.redraw === (b as typeof a).redraw
   376	    case 'castCharacter':
   377	    case 'castSummon': return a.card === (b as typeof a).card && samePayment(a.payment, (b as typeof a).payment)
   378	    case 'declareAttack': return sameIds(a.attackers, (b as typeof a).attackers)
   379	    case 'declareBlock': return a.blocker === (b as typeof a).blocker
   380	    case 'assignPartyDamage': {
   381	      const key = (x: { target: CardId; amount: number }) => `${x.target}:${x.amount}`
   382	      const other = (b as typeof a).assignments.map(key).sort()
   383	      return a.assignments.length === other.length && a.assignments.map(key).sort().every((k, i) => k === other[i])
   384	    }
   385	    case 'discardToHandSize': return sameIds(a.cards, (b as typeof a).cards)
   386	    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
   387	    case 'chooseMode': return sameIds([...a.modes], [...(b as typeof a).modes])
   388	    case 'activateAbility': {
   389	      const o = b as typeof a
   390	      return a.source === o.source && a.abilityId === o.abilityId && samePayment(a.payment, o.payment)
   391	    }
   392	    case 'pass': case 'concede': return true
   393	    default: { const _exhaustive: never = a; return _exhaustive }
   394	  }
   395	}
   396	
   397	type CastCommand = Extract<Command, { type: 'castCharacter' | 'castSummon' }>
   398	type ActivateCommand = Extract<Command, { type: 'activateAbility' }>
   399	/**
   400	 * Both kinds of command that carry a `Payment`, and therefore both kinds that `legalCommands` explodes into
   401	 * one entry per minimal payment. C3 added the second; collapsing only casts would have put a separate button
   402	 * on the board for every way of paying for the same Red Mage ability.
   403	 */
   404	type PayableCommand = CastCommand | ActivateCommand
   405	const isCast = (c: Command): c is CastCommand => c.type === 'castCharacter' || c.type === 'castSummon'
   406	const isPayable = (c: Command): c is PayableCommand => isCast(c) || c.type === 'activateAbility'
   407	/** What counts as "the same move, paid differently". */
   408	const payableKey = (c: PayableCommand): string =>
   409	  c.type === 'activateAbility' ? `a:${c.source}:${c.abilityId}` : `c:${c.card}`
   410	
   411	/**
   412	 * `preferredPayment` reads only the acting player's own backups, hand and the shared card/def tables — all of it
   413	 * already in the human's own `PlayerView` — but its signature takes a `GameState`. Rebuild the minimum of one
   414	 * rather than threading `GameState` into the view layer (spec B3: the React tree never sees it). Both decks and
   415	 * the opponent's hand stay empty: nothing hidden goes in, so nothing hidden can come back out in a payment.
   416	 */
   417	function stateShim(v: PlayerView): GameState {
   418	  const side = (p: PlayerId): PlayerState => ({
   419	    deck: [], hand: p === v.me ? [...v.hand] : [],
   420	    forwards: v.fields[p].forwards, backups: v.fields[p].backups,
   421	    damageZone: v.fields[p].damageZone, breakZone: v.fields[p].breakZone,
   422	    mulliganDecided: v.mulliganDecided[p],
   423	  })
   424	  return {
   425	    rng: seedRng(0), turn: v.turn, turnPlayer: v.turnPlayer, firstPlayer: v.firstPlayer, phase: v.phase,
   426	    attack: v.attack, priority: v.priority, pending: v.pending, resolution: v.resolution, players: [side(0), side(1)],
   427	    cards: v.cards, defs: v.defs, result: v.result,
   428	  }
   429	}
   430	
   431	/**
   432	 * Spec B6: `legalCommands` enumerates every *minimal* payment, so one castable card can appear dozens of times.
   433	 * Collapse each card's casts to a single choice — the payment `preferredPayment` picks, falling back to that
   434	 * card's first legal payment when it returns `null` or picks a non-minimal one `legalCommands` never listed.
   435	 * Non-cast commands pass through untouched, and the surviving cast keeps the position of the card's first
   436	 * payment, so the whole list stays in `legalCommands` order. Feed the result to `buildChoiceSet`.
   437	 */
   438	export function preferredChoices(v: PlayerView, legal: Command[]): Command[] {
   439	  const payable = legal.filter(isPayable)
   440	  if (!payable.length) return legal
   441	  const keep = new Map<string, Command>()
   442	  for (const c of payable) if (!keep.has(payableKey(c))) keep.set(payableKey(c), c)
   443	  const shim = stateShim(v)
   444	  for (const c of payable) {
   445	    const key = payableKey(c)
   446	    const preferred = preferredFor(shim, v, c)
   447	    if (!preferred) continue
   448	    const match = payable.find((o) => payableKey(o) === key && samePayment(o.payment, preferred))
   449	    if (match) keep.set(key, match)
   450	  }
   451	  const seen = new Set<string>()
   452	  const out: Command[] = []
   453	  for (const c of legal) {
   454	    if (!isPayable(c)) { out.push(c); continue }
   455	    const key = payableKey(c)
   456	    if (seen.has(key)) continue
   457	    seen.add(key)
   458	    out.push(keep.get(key) ?? c)
   459	  }
   460	  return out
   461	}
   462	
   463	/** The payment the AI's own value-minimising chooser would pick for this move. */
   464	function preferredFor(shim: GameState, v: PlayerView, c: PayableCommand): Payment | null {
   465	  if (c.type !== 'activateAbility') return preferredPayment(shim, v.me, c.card)
   466	  const ability = activatedAbilityOf(v, c.source, c.abilityId)
   467	  if (!ability || ability.trigger.kind !== 'activated') return null
   468	  return preferredPaymentFor(shim, v.me, abilityCpRequirement(c.source, ability.trigger.cost))
   469	}
   470	
   471	/** The activated clause `abilityId` names, read off the view's own definitions. */
   472	function activatedAbilityOf(v: PlayerView, source: CardId, abilityId: string): Ability | undefined {
   473	  const def = v.defs[v.cards[source]?.code ?? '']
   474	  return (def?.abilities ?? []).find((a) => a.id === abilityId)
   475	}
   476	
   477	/** The printed cost of one activated clause, for the button label. */
   478	function activatedCostOf(v: PlayerView, source: CardId, abilityId: string): string {
   479	  const ability = activatedAbilityOf(v, source, abilityId)
   480	  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'Ability'
   481	}
    40	  return text === undefined ? null : text.replace(/\s+/g, ' ').trim()
    41	}
    42	
    43	/**
    44	 * One log line per engine event, named from the HUMAN's *post-apply* view — by the time an event is narrated the
    45	 * card it names has moved somewhere public (field, damage zone, break zone), so nothing here can name a card the
    46	 * human may not see. `null` drops events the move line above them already states (`cast`, `attackDeclared`, the
    47	 * CP that paid for them), keeping the log a narrative rather than a trace.
    48	 *
    49	 * `cause` is what fired an `abilityTriggered` (spec C2-5) — `eventLines` supplies it; it is ignored everywhere
    50	 * else. Callers narrating a single event out of context can leave it off.
    51	 */
    52	export function describeEvent(v: PlayerView, e: Event, cause: TriggerCause | null = null): LogLine | null {
    53	  switch (e.type) {
    54	    case 'firstPlayerChosen': return { kind: 'phase', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} the first turn` }
    55	    case 'mulligan': return { kind: 'event', text: `${who(v, e.player)} ${whoDoes(v, e.player, e.redraw ? 'mulligan' : 'keep your hand', e.redraw ? 'mulligans' : 'keeps its hand')}` }
    56	    case 'turnStarted': return { kind: 'phase', text: `Turn ${e.turn} — ${whoDoes(v, e.player, 'your turn', "the AI's turn")}` }
    57	    case 'phaseStarted': return { kind: 'phase', text: `${PHASE_LABEL[e.phase] ?? e.phase}${e.step ? ` — ${e.step}` : ''}` }
    58	    case 'drew': return { kind: 'event', text: `${who(v, e.player)} draw${e.player === v.me ? '' : 's'} ${e.count} card${e.count === 1 ? '' : 's'}` }
    59	    case 'discarded': return e.reason === 'cp' ? null : { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${name(v, e.card)} to the hand limit` }
    60	    // B-A6 + C1-9: coverage is per CLAUSE. `clauses` counts the ones still missing on a card that DOES have an
    61	    // implemented clause; its absence means the whole text box is unimplemented and the card played as vanilla.
    62	    case 'unimplementedAbility': return e.clauses === undefined
    63	      ? { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has abilities that are not implemented yet — played as vanilla` }
    64	      : { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has ${e.clauses} more ability clause${e.clauses === 1 ? '' : 's'} that ${e.clauses === 1 ? 'is' : 'are'} not implemented yet` }
    65	    case 'exBurstSkipped': return { kind: 'warning', text: `EX Burst on ${name(v, e.card)} skipped (not implemented)` }
    66	    case 'battleDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    67	    case 'playerDamaged': return { kind: 'event', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} 1 damage` }
    68	    case 'broken': return { kind: 'event', text: `${name(v, e.card)} is broken` }
    69	    case 'putIntoBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone (0 power)` }
    70	    // --- ability resolution (rung C1). The choice itself is already a move line — the human's from `choose`,
    71	    // the AI's from `stepAi` — so these narrate what triggered and what it DID, closing the loop between the
    72	    // printed text box and the board state the player is looking at.
    73	    // C2: an OBSERVER trigger fires because of something that happened to a DIFFERENT card, so the cause goes
    74	    // in front of the printed text. "Lightning's ability triggers — the AI's Prishe was broken" is the only
    75	    // thing tying the prompt that follows to the board; and for a clause with no prompt at all (Luso's "break
    76	    // it") the log is the ONLY evidence the trigger happened.
    77	    case 'abilityTriggered': {
    78	      const text = abilityText(v, e.card, e.abilityId)
    79	      const why = cause ? ` — ${describeTriggerCause(v, cause)}` : ''
    80	      return { kind: 'event', text: `${name(v, e.card)}'s ability triggers${why}${text ? `: "${text}"` : ''}` }
    81	    }
    82	    // C3: ACTIVATED, not triggered. The distinction is the whole of what this rung added for the player —
    83	    // "triggers" would report a move they deliberately made as something that merely happened to them.
    84	    case 'abilityActivated': {
    85	      const text = abilityText(v, e.card, e.abilityId)
    86	      const whose = e.player === v.me ? 'Your' : "The AI's"
    87	      return { kind: 'event', text: `${whose} ${name(v, e.card)} activates${text ? `: "${text}"` : ''}` }
    88	    }
    89	    case 'paidToBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone to pay for it` }
    90	    case 'abilityNoLegalTarget': return { kind: 'event', text: `${name(v, e.card)}'s ability finds no legal target — nothing happens` }
    91	    case 'dulled': return { kind: 'event', text: `${name(v, e.card)} is dulled` }
    92	    case 'abilityDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    93	    case 'powerModified': return { kind: 'event', text: `${name(v, e.card)} gets ${e.amount >= 0 ? '+' : ''}${e.amount} power until the end of the turn` }
    94	    case 'keywordGranted': return { kind: 'event', text: `${name(v, e.card)} gains ${KEYWORD_LABEL[e.keyword]} until the end of the turn` }
    95	    case 'flagGranted': return { kind: 'event', text: `${name(v, e.card)} ${FLAG_LABEL[e.flag]}` }
    96	    case 'returnedToHand': return { kind: 'event', text: `${name(v, e.card)} returns to ${whoDoes(v, e.player, 'your hand', "the AI's hand")}` }
    97	    case 'brokenByAbility': return { kind: 'event', text: `${name(v, e.card)} is broken by ${name(v, e.source)}` }
    98	    case 'breakPrevented': return { kind: 'event', text: `${name(v, e.card)} survives — it ${FLAG_LABEL[e.flag]}` }
    99	    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'} (${e.result.reason})` }
   100	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
   101	    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
   102	    default: return null
   103	  }
   104	}
   105	
   106	/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
   107	function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
   108	  const code = v.cards[card]?.code
   109	  const def = code === undefined ? undefined : v.defs[code]
   110	  return def?.abilities?.find((a) => a.id === abilityId)?.trigger ?? null
   111	}
   112	
   113	/**
   114	 * §7.10 puts a broken card in its OWNER's Break Zone, which is where narration finds it once it has left the
   115	 * field. Owner and controller coincide for this pool — nothing in it changes control (rung C5) — so this is
   116	 * the controller the clause's `whose` is measured against.
   117	 */
   118	function holderOf(v: PlayerView, id: CardId): PlayerId {
   119	  for (const p of [0, 1] as const) if (v.fields[p].breakZone.includes(id)) return p
   120	  return v.cards[id]?.owner ?? v.me
   121	}
   122	
   123	interface Hit { readonly source: CardId; readonly target: CardId; readonly amount: number; used: boolean }
   124	interface PlayerHit { readonly victim: PlayerId; used: boolean }
   125	interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; readonly reason: ZoneTransitionReason; used: boolean }
     1	import type { CardId, Command, FieldCard, PlayerView } from '@fftcg/engine'
     2	import { describeAbilityCost } from '@fftcg/engine'
     3	
     4	const PHASE_LABEL: Record<string, string> = { setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase' }
     5	
     6	function name(v: PlayerView, id: CardId): string {
     7	  const inst = v.cards[id]
     8	  if (!inst) return `#${id}`
     9	  const d = v.defs[inst.code]
    10	  return d ? `${d.name} (${d.code})` : inst.code
    11	}
    12	function fieldCard(v: PlayerView, c: FieldCard): string {
    13	  const d = v.defs[v.cards[c.id]?.code ?? '']
    14	  const power = d?.power != null ? ` ${d.power - c.damage}/${d.power}` : ''
    15	  const flags = [c.status === 'dull' ? 'DULL' : '', c.attackedThisTurn ? 'attacked' : '', ...c.granted].filter(Boolean).join(',')
    16	  return `[${c.id}] ${d?.name ?? '?'}${power}${flags ? ` {${flags}}` : ''}`
    17	}
    18	
    19	export function renderView(v: PlayerView): string {
    20	  const opp = v.me === 0 ? 1 : 0
    21	  const step = v.attack ? ` / ${v.pending?.kind === 'assignPartyDamage' ? 'assign party damage' : v.attack.step}` : ''
    22	  const lines = [
    23	    `=== Turn ${v.turn} — P${v.turnPlayer}'s turn — ${PHASE_LABEL[v.phase]}${step} — you are P${v.me} ===`,
    24	    `Opponent P${opp}: deck ${v.fields[opp].deckCount}, hand ${v.fields[opp].handCount}, damage ${v.fields[opp].damageZone.length}/7, break ${v.fields[opp].breakZone.length}`,
    25	    `  Forwards: ${v.fields[opp].forwards.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    26	    `  Backups:  ${v.fields[opp].backups.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    27	    `You P${v.me}: deck ${v.fields[v.me].deckCount}, damage ${v.fields[v.me].damageZone.length}/7, break ${v.fields[v.me].breakZone.length}`,
    28	    `  Forwards: ${v.fields[v.me].forwards.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    29	    `  Backups:  ${v.fields[v.me].backups.map((c) => fieldCard(v, c)).join('  ') || '-'}`,
    30	    `  Hand (${v.hand.length}): ${v.hand.map((id) => `[${id}] ${name(v, id)}`).join('  ')}`,
    31	  ]
    32	  if (v.attack?.attackers.length) lines.push(`  Attacking: ${v.attack.attackers.map((id) => name(v, id)).join(' + ')}${v.attack.blocker !== null ? ` blocked by ${name(v, v.attack.blocker)}` : ''}`)
    33	  if (v.result) lines.push(`*** GAME OVER: ${v.result.winner === null ? 'draw' : `P${v.result.winner} wins`} — ${v.result.reason}`)
    34	  return lines.join('\n')
    35	}
    36	
    37	export function describeCommand(v: PlayerView, c: Command): string {
    38	  switch (c.type) {
    39	    case 'chooseFirst': return c.goFirst ? 'Take the first turn' : 'Let the opponent go first'
    40	    case 'mulligan': return c.redraw ? 'Mulligan (redraw 5)' : 'Keep hand'
    41	    case 'castCharacter':
    42	    case 'castSummon': {
    43	      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
    44	      return `Cast ${name(v, c.card)} paying: ${pay.join(', ') || 'nothing'}`
    45	    }
    46	    case 'chooseTargets': return c.targets.length ? `Target ${c.targets.map((id) => name(v, id)).join(', ')}` : 'Choose no targets'
    47	    case 'chooseMode': return c.modes.length ? `Choose mode ${c.modes.map((i) => i + 1).join(' + ')}` : 'Choose no modes'
    48	    case 'declareAttack': return `Attack with ${c.attackers.map((id) => name(v, id)).join(' + ')}`
    49	    case 'declareBlock': return c.blocker === null ? 'No block' : `Block with ${name(v, c.blocker)}`
    50	    case 'assignPartyDamage': return `Assign damage: ${c.assignments.map((a) => `${a.amount} → ${name(v, a.target)}`).join(', ')}`
    51	    case 'discardToHandSize': return `Discard ${c.cards.map((id) => name(v, id)).join(', ')}`
    52	    case 'activateAbility': {
    53	      const pay = [...c.payment.dullBackups.map((id) => `dull ${name(v, id)}`), ...c.payment.discards.map((d) => `discard ${name(v, d.card)} as ${d.element}`)]
    54	      const cost = abilityCostOf(v, c.source, c.abilityId)
    55	      return `Use ${name(v, c.source)}'s ${cost} ability${pay.length ? ` paying: ${pay.join(', ')}` : ''}`
    56	    }
    57	    case 'pass': return 'Pass'
    58	    case 'concede': return 'Concede'
    59	  }
    60	}
    61	
    62	/** The printed cost of one activated clause, for the command label. */
    63	function abilityCostOf(v: PlayerView, source: number, abilityId: string): string {
    64	  const def = v.defs[v.cards[source]?.code ?? '']
    65	  const ability = (def?.abilities ?? []).find((a) => a.id === abilityId)
    66	  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'ability'
    67	}

exec
/bin/zsh -lc "nl -ba apps/web/src/game/commands.ts | sed -n '310,405p'; nl -ba apps/web/src/game/useGame.ts | sed -n '1,190p'; nl -ba apps/web/src/game/useGame.ts | sed -n '190,430p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   310	  }
   311	}
   312	
   313	/** Every card a command acts on. Order matters: the first is the click-target `Choice.card` hangs off. */
   314	function subjectsOf(c: Command): CardId[] {
   315	  switch (c.type) {
   316	    case 'castCharacter':
   317	    case 'castSummon': return [c.card]
   318	    case 'declareAttack': return c.attackers
   319	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
   320	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
   321	    case 'discardToHandSize': return c.cards
   322	    // Spec B-A4 + C1-6: the subjects of a target answer are exactly its targets, so the board lights up the
   323	    // legal candidates and nothing else — clicking one is how the set gets picked.
   324	    case 'chooseTargets': return [...c.targets]
   325	    // An activation is an action taken BY a card, so its subject is the source — clicking the card is how you
   326	    // use it. The CP sources are deliberately not subjects: they are payment, chosen for you.
   327	    case 'activateAbility': return [c.source]
   328	    // `chooseMode` has no card subject at all: its options are printed wordings, so they are strip buttons.
   329	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
   330	    default: { const _exhaustive: never = c; return _exhaustive }
   331	  }
   332	}
   333	
   334	/**
   335	 * Group `legal` into the click map the board renders from. Spec B-A4: a card is clickable IFF it is a key of
   336	 * `byCard`, so an illegal click is unrepresentable rather than rejected after the fact. A command with several
   337	 * subjects (a multi-forward attack party, a damage split, a multi-card discard) is listed under *every* one of
   338	 * them — clicking any member of a party has to offer that party — while `Choice.card`, which is singular, keeps
   339	 * the first as the label's anchor.
   340	 */
   341	export function buildChoiceSet(v: PlayerView, legal: Command[]): ChoiceSet {
   342	  const all: Choice[] = []
   343	  const byCard = new Map<CardId, Choice[]>()
   344	  const loose: Choice[] = []
   345	  for (const command of legal) {
   346	    const subjects = subjectsOf(command)
   347	    const choice: Choice = { command, label: describeChoice(v, command), card: subjects[0] ?? null }
   348	    all.push(choice)
   349	    if (!subjects.length) { loose.push(choice); continue }
   350	    for (const id of subjects) byCard.set(id, [...(byCard.get(id) ?? []), choice])
   351	  }
   352	  return { all, byCard, loose, prompt: promptFor(v) }
   353	}
   354	
   355	function sameIds(a: readonly CardId[], b: readonly CardId[]): boolean {
   356	  if (a.length !== b.length) return false
   357	  const sortedB = [...b].sort((x, y) => x - y)
   358	  return [...a].sort((x, y) => x - y).every((id, i) => id === sortedB[i])
   359	}
   360	
   361	/** Payments are sets of sources, not sequences — `legalCommands` and `preferredPayment` build them in different orders. */
   362	export function samePayment(a: Payment, b: Payment): boolean {
   363	  if (!sameIds(a.dullBackups, b.dullBackups)) return false
   364	  if (a.discards.length !== b.discards.length) return false
   365	  const key = (d: Payment['discards'][number]) => `${d.card}:${d.element}`
   366	  const bKeys = b.discards.map(key).sort()
   367	  return a.discards.map(key).sort().every((k, i) => k === bKeys[i])
   368	}
   369	
   370	/** Structural equality, used by `useGame.choose` to prove a command is in the current legal set before applying. */
   371	export function sameCommand(a: Command, b: Command): boolean {
   372	  if (a.type !== b.type || a.player !== b.player) return false
   373	  switch (a.type) {
   374	    case 'chooseFirst': return a.goFirst === (b as typeof a).goFirst
   375	    case 'mulligan': return a.redraw === (b as typeof a).redraw
   376	    case 'castCharacter':
   377	    case 'castSummon': return a.card === (b as typeof a).card && samePayment(a.payment, (b as typeof a).payment)
   378	    case 'declareAttack': return sameIds(a.attackers, (b as typeof a).attackers)
   379	    case 'declareBlock': return a.blocker === (b as typeof a).blocker
   380	    case 'assignPartyDamage': {
   381	      const key = (x: { target: CardId; amount: number }) => `${x.target}:${x.amount}`
   382	      const other = (b as typeof a).assignments.map(key).sort()
   383	      return a.assignments.length === other.length && a.assignments.map(key).sort().every((k, i) => k === other[i])
   384	    }
   385	    case 'discardToHandSize': return sameIds(a.cards, (b as typeof a).cards)
   386	    case 'chooseTargets': return sameIds([...a.targets], [...(b as typeof a).targets])
   387	    case 'chooseMode': return sameIds([...a.modes], [...(b as typeof a).modes])
   388	    case 'activateAbility': {
   389	      const o = b as typeof a
   390	      return a.source === o.source && a.abilityId === o.abilityId && samePayment(a.payment, o.payment)
   391	    }
   392	    case 'pass': case 'concede': return true
   393	    default: { const _exhaustive: never = a; return _exhaustive }
   394	  }
   395	}
   396	
   397	type CastCommand = Extract<Command, { type: 'castCharacter' | 'castSummon' }>
   398	type ActivateCommand = Extract<Command, { type: 'activateAbility' }>
   399	/**
   400	 * Both kinds of command that carry a `Payment`, and therefore both kinds that `legalCommands` explodes into
   401	 * one entry per minimal payment. C3 added the second; collapsing only casts would have put a separate button
   402	 * on the board for every way of paying for the same Red Mage ability.
   403	 */
   404	type PayableCommand = CastCommand | ActivateCommand
   405	const isCast = (c: Command): c is CastCommand => c.type === 'castCharacter' || c.type === 'castSummon'
     1	import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
     2	import {
     3	  actingPlayer, apply, createGame, legalCommands, viewFor,
     4	  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView, type ZoneTransitionReason,
     5	} from '@fftcg/engine'
     6	import type { Agent } from '@fftcg/ai'
     7	import { CARD_DEFS, DECKS } from '../deck.js'
     8	import { buildChoiceSet, describeChoice, describeTriggerCause, preferredChoices, sameCommand, type TriggerCause } from './commands.js'
     9	import { SearchCoordinator, type SearchCoordinatorOptions, type SearchRequestHandlers } from './search/coordinator.js'
    10	import { AI, HUMAN, type Choice, type GameApi, type LogLine } from './types.js'
    11	
    12	/** Spec B7: the agent decides in ~0.27 ms, far too fast to watch — one move per this many ms instead. */
    13	export const AI_STEP_MS = 600
    14	
    15	const PHASE_LABEL: Record<string, string> = {
    16	  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase',
    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
    18	}
    19	
    20	function name(v: PlayerView, id: number): string {
    21	  const inst = v.cards[id]
    22	  if (!inst) return `#${id}`
    23	  return v.defs[inst.code]?.name ?? inst.code
    24	}
    25	const who = (v: PlayerView, p: PlayerId): string => (p === v.me ? 'You' : 'The AI')
    26	const whoDoes = (v: PlayerView, p: PlayerId, mine: string, theirs: string): string => (p === v.me ? mine : theirs)
    27	
    28	const KEYWORD_LABEL: Record<Keyword, string> = { haste: 'Haste', brave: 'Brave', firstStrike: 'First Strike', backAttack: 'Back Attack' }
    29	const FLAG_LABEL: Record<FieldFlag, string> = { cannotBeBroken: 'cannot be broken this turn' }
    30	
    31	/**
    32	 * The printed wording of the clause that is resolving, quoted from the AST on `CardDef` (spec C1-1). Printed
    33	 * text is multi-line — a modal clause prints one line per mode — and a log line is one line, so runs of
    34	 * whitespace collapse. Nothing else about the wording is touched: reviewers check the AST against THIS.
    35	 */
    36	function abilityText(v: PlayerView, card: number, abilityId: string): string | null {
    37	  const code = v.cards[card]?.code
    38	  const def = code === undefined ? undefined : v.defs[code]
    39	  const text = def?.abilities?.find((a) => a.id === abilityId)?.text
    40	  return text === undefined ? null : text.replace(/\s+/g, ' ').trim()
    41	}
    42	
    43	/**
    44	 * One log line per engine event, named from the HUMAN's *post-apply* view — by the time an event is narrated the
    45	 * card it names has moved somewhere public (field, damage zone, break zone), so nothing here can name a card the
    46	 * human may not see. `null` drops events the move line above them already states (`cast`, `attackDeclared`, the
    47	 * CP that paid for them), keeping the log a narrative rather than a trace.
    48	 *
    49	 * `cause` is what fired an `abilityTriggered` (spec C2-5) — `eventLines` supplies it; it is ignored everywhere
    50	 * else. Callers narrating a single event out of context can leave it off.
    51	 */
    52	export function describeEvent(v: PlayerView, e: Event, cause: TriggerCause | null = null): LogLine | null {
    53	  switch (e.type) {
    54	    case 'firstPlayerChosen': return { kind: 'phase', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} the first turn` }
    55	    case 'mulligan': return { kind: 'event', text: `${who(v, e.player)} ${whoDoes(v, e.player, e.redraw ? 'mulligan' : 'keep your hand', e.redraw ? 'mulligans' : 'keeps its hand')}` }
    56	    case 'turnStarted': return { kind: 'phase', text: `Turn ${e.turn} — ${whoDoes(v, e.player, 'your turn', "the AI's turn")}` }
    57	    case 'phaseStarted': return { kind: 'phase', text: `${PHASE_LABEL[e.phase] ?? e.phase}${e.step ? ` — ${e.step}` : ''}` }
    58	    case 'drew': return { kind: 'event', text: `${who(v, e.player)} draw${e.player === v.me ? '' : 's'} ${e.count} card${e.count === 1 ? '' : 's'}` }
    59	    case 'discarded': return e.reason === 'cp' ? null : { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${name(v, e.card)} to the hand limit` }
    60	    // B-A6 + C1-9: coverage is per CLAUSE. `clauses` counts the ones still missing on a card that DOES have an
    61	    // implemented clause; its absence means the whole text box is unimplemented and the card played as vanilla.
    62	    case 'unimplementedAbility': return e.clauses === undefined
    63	      ? { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has abilities that are not implemented yet — played as vanilla` }
    64	      : { kind: 'warning', text: `${name(v, e.card)} (${e.code}) has ${e.clauses} more ability clause${e.clauses === 1 ? '' : 's'} that ${e.clauses === 1 ? 'is' : 'are'} not implemented yet` }
    65	    case 'exBurstSkipped': return { kind: 'warning', text: `EX Burst on ${name(v, e.card)} skipped (not implemented)` }
    66	    case 'battleDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    67	    case 'playerDamaged': return { kind: 'event', text: `${who(v, e.player)} take${e.player === v.me ? '' : 's'} 1 damage` }
    68	    case 'broken': return { kind: 'event', text: `${name(v, e.card)} is broken` }
    69	    case 'putIntoBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone (0 power)` }
    70	    // --- ability resolution (rung C1). The choice itself is already a move line — the human's from `choose`,
    71	    // the AI's from `stepAi` — so these narrate what triggered and what it DID, closing the loop between the
    72	    // printed text box and the board state the player is looking at.
    73	    // C2: an OBSERVER trigger fires because of something that happened to a DIFFERENT card, so the cause goes
    74	    // in front of the printed text. "Lightning's ability triggers — the AI's Prishe was broken" is the only
    75	    // thing tying the prompt that follows to the board; and for a clause with no prompt at all (Luso's "break
    76	    // it") the log is the ONLY evidence the trigger happened.
    77	    case 'abilityTriggered': {
    78	      const text = abilityText(v, e.card, e.abilityId)
    79	      const why = cause ? ` — ${describeTriggerCause(v, cause)}` : ''
    80	      return { kind: 'event', text: `${name(v, e.card)}'s ability triggers${why}${text ? `: "${text}"` : ''}` }
    81	    }
    82	    // C3: ACTIVATED, not triggered. The distinction is the whole of what this rung added for the player —
    83	    // "triggers" would report a move they deliberately made as something that merely happened to them.
    84	    case 'abilityActivated': {
    85	      const text = abilityText(v, e.card, e.abilityId)
    86	      const whose = e.player === v.me ? 'Your' : "The AI's"
    87	      return { kind: 'event', text: `${whose} ${name(v, e.card)} activates${text ? `: "${text}"` : ''}` }
    88	    }
    89	    case 'paidToBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone to pay for it` }
    90	    case 'abilityNoLegalTarget': return { kind: 'event', text: `${name(v, e.card)}'s ability finds no legal target — nothing happens` }
    91	    case 'dulled': return { kind: 'event', text: `${name(v, e.card)} is dulled` }
    92	    case 'abilityDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
    93	    case 'powerModified': return { kind: 'event', text: `${name(v, e.card)} gets ${e.amount >= 0 ? '+' : ''}${e.amount} power until the end of the turn` }
    94	    case 'keywordGranted': return { kind: 'event', text: `${name(v, e.card)} gains ${KEYWORD_LABEL[e.keyword]} until the end of the turn` }
    95	    case 'flagGranted': return { kind: 'event', text: `${name(v, e.card)} ${FLAG_LABEL[e.flag]}` }
    96	    case 'returnedToHand': return { kind: 'event', text: `${name(v, e.card)} returns to ${whoDoes(v, e.player, 'your hand', "the AI's hand")}` }
    97	    case 'brokenByAbility': return { kind: 'event', text: `${name(v, e.card)} is broken by ${name(v, e.source)}` }
    98	    case 'breakPrevented': return { kind: 'event', text: `${name(v, e.card)} survives — it ${FLAG_LABEL[e.flag]}` }
    99	    case 'gameOver': return { kind: 'result', text: `Game over — ${e.result.winner === null ? 'a draw' : e.result.winner === v.me ? 'you win' : 'the AI wins'} (${e.result.reason})` }
   100	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
   101	    // `summonResolvedNoEffect` are noise (the latter doubles up on `unimplementedAbility` for every summon in the pool).
   102	    default: return null
   103	  }
   104	}
   105	
   106	/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
   107	function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
   108	  const code = v.cards[card]?.code
   109	  const def = code === undefined ? undefined : v.defs[code]
   110	  return def?.abilities?.find((a) => a.id === abilityId)?.trigger ?? null
   111	}
   112	
   113	/**
   114	 * §7.10 puts a broken card in its OWNER's Break Zone, which is where narration finds it once it has left the
   115	 * field. Owner and controller coincide for this pool — nothing in it changes control (rung C5) — so this is
   116	 * the controller the clause's `whose` is measured against.
   117	 */
   118	function holderOf(v: PlayerView, id: CardId): PlayerId {
   119	  for (const p of [0, 1] as const) if (v.fields[p].breakZone.includes(id)) return p
   120	  return v.cards[id]?.owner ?? v.me
   121	}
   122	
   123	interface Hit { readonly source: CardId; readonly target: CardId; readonly amount: number; used: boolean }
   124	interface PlayerHit { readonly victim: PlayerId; used: boolean }
   125	interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; readonly reason: ZoneTransitionReason; used: boolean }
   126	
   127	/**
   128	 * Pair one `abilityTriggered` with the event that fired it, consuming the candidate so the NEXT trigger of the
   129	 * same clause gets the next one (CR §11.8.6 / spec C2-A3: one Lightning watching two simultaneous breaks
   130	 * triggers twice, and the two lines must not both name the same Forward).
   131	 *
   132	 * `dealtDamage` is exact by construction: `enqueueDamageTriggers` hangs the clause off the DAMAGE SOURCE, so
   133	 * the watcher id IS the source to match on. `observesZoneChange` is matched on `whose` relative to the frame's
   134	 * own controller (`e.player`), never the turn player — spec C2-10, so the clause means the same from either
   135	 * seat. Anything unmatched returns null and the line simply loses its cause clause rather than gaining a
   136	 * wrong one.
   137	 */
   138	function causeOf(
   139	  v: PlayerView, e: Extract<Event, { type: 'abilityTriggered' }>,
   140	  hits: Hit[], playerHits: PlayerHit[], zoneHits: ZoneHit[],
   141	): TriggerCause | null {
   142	  const trigger = triggerOf(v, e.card, e.abilityId)
   143	  if (!trigger) return null
   144	  if (trigger.kind === 'dealtDamage') {
   145	    if (trigger.to === 'player') {
   146	      const hit = playerHits.find((h) => !h.used)
   147	      if (!hit) return null
   148	      hit.used = true
   149	      return { kind: 'damage', source: e.card, target: null, victim: hit.victim, amount: 1 }
   150	    }
   151	    const hit = hits.find((h) => !h.used && h.source === e.card)
   152	    if (!hit) return null
   153	    hit.used = true
   154	    return { kind: 'damage', source: hit.source, target: hit.target, victim: null, amount: hit.amount }
   155	  }
   156	  if (trigger.kind === 'observesZoneChange') {
   157	    const wants = (controller: PlayerId): boolean =>
   158	      trigger.whose === 'any' || (trigger.whose === 'self') === (controller === e.player)
   159	    const hit = zoneHits.find((h) => !h.used && wants(h.controller))
   160	    if (!hit) return null
   161	    hit.used = true
   162	    return { kind: 'zoneChange', card: hit.card, controller: hit.controller, reason: hit.reason }
   163	  }
   164	  return null   // enterField/summonResolve are about the source itself — there is nothing to explain
   165	}
   166	
   167	/**
   168	 * Narrate one command's events, saying what each triggered clause was reacting to (spec C2-5).
   169	 *
   170	 * `queued` is the agenda queue as it stood BEFORE the command, and it is the exact answer wherever it reaches:
   171	 * those frames carry their own `triggerEvent`, `drainResolution` starts them FIFO, and starting a frame is what
   172	 * emits `abilityTriggered` — so the n-th trigger of the batch is `queued[n]`. That is what rescues a trigger
   173	 * whose cause happened in an EARLIER batch: a second Lightning occurrence sits in the queue across the prompt
   174	 * the first one raised, and by the time it starts, the break that fired it is long gone from the event stream.
   175	 *
   176	 * A frame both queued and drained inside THIS batch is in no queue anyone can see, so its cause is
   177	 * reconstructed from the events instead — `causeOf`. That is the common case (Luso's "break it" raises no
   178	 * prompt at all) and it is sound because the engine pushes a damage or break event before the trigger that
   179	 * event queues, transition-major (spec C2-11). Both routes are guarded: an unmatched trigger loses its cause
   180	 * clause rather than gaining a wrong one.
   181	 */
   182	export function eventLines(v: PlayerView, events: readonly Event[], queued: readonly Frame[] = []): LogLine[] {
   183	  const hits: Hit[] = []
   184	  const playerHits: PlayerHit[] = []
   185	  const zoneHits: ZoneHit[] = []
   186	  const lines: LogLine[] = []
   187	  let started = 0
   188	  for (const e of events) {
   189	    switch (e.type) {
   190	      // Combat and ability damage alike — the printed text says "deals damage" (spec C2-7).
   190	      // Combat and ability damage alike — the printed text says "deals damage" (spec C2-7).
   191	      case 'battleDamage':
   192	      case 'abilityDamage': hits.push({ source: e.source, target: e.target, amount: e.amount, used: false }); break
   193	      // `playerDamaged.card` is the card TAKEN as damage, not the dealer; the dealer is the watcher itself.
   194	      case 'playerDamaged': playerHits.push({ victim: e.player, used: false }); break
   195	      case 'broken':
   196	      case 'brokenByAbility':
   197	      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), reason: 'ability', used: false }); break
   198	      // C3: paying a cost moves a card the same way a break does, so an observer of the MOVEMENT fires on it
   199	      // and the log needs the same cause available — tagged, so it is not narrated as a break.
   200	      case 'paidToBreakZone': zoneHits.push({ card: e.card, controller: e.player, reason: 'cost', used: false }); break
   201	      default: break
   202	    }
   203	    let cause: TriggerCause | null = null
   204	    if (e.type === 'abilityTriggered') {
   205	      const frame = queued[started++]
   206	      // The identity check is the guard on the FIFO assumption: mismatch means the queue is not what this
   207	      // trigger came from, so fall through to reconstruction rather than narrate another clause's subject.
   208	      cause = frame && frame.source === e.card && frame.abilityId === e.abilityId
   209	        ? frame.triggerEvent
   210	        : causeOf(v, e, hits, playerHits, zoneHits)
   211	    }
   212	    const line = describeEvent(v, e, cause)
   213	    if (line) lines.push(line)
   214	  }
   215	  return lines
   216	}
   217	
   218	/**
   219	 * The view a command's events are narrated from: the state AFTER it, plus the cards that were public BEFORE.
   220	 * An ability can move a card out of a public zone into a hidden one — Billy Bob returns a Forward from the
   221	 * Break Zone to its owner's HAND — and `#51 returns to the AI's hand` is a worse log line than naming a card
   222	 * whose identity the player could read off the table a moment ago. Nothing hidden before can enter this union,
   223	 * so B-A3 still holds: `before` is itself a human view.
   224	 */
   225	export const narrator = (before: PlayerView, after: PlayerView): PlayerView => ({ ...after, cards: { ...before.cards, ...after.cards } })
   226	
   227	/**
   228	 * Narrate and apply one already-chosen command. Split out of `stepAi` because the browser's opponent no longer
   229	 * comes from an `Agent` at all — it comes back from a worker (spec D2) — and both paths must produce the same
   230	 * log. The membership check is spec B-A4 held to both seats: `apply` is never reached by a command outside
   231	 * `legalCommands`.
   232	 */
   233	function narrateApply(
   234	  state: GameState, actorView: PlayerView, legal: readonly Command[], command: Command,
   235	): { state: GameState; lines: LogLine[] } {
   236	  if (!legal.some((c) => sameCommand(c, command))) throw new Error(`agent chose an illegal command: ${command.type}`)
   237	  const before = viewFor(state, HUMAN)
   238	  const result = apply(state, command)
   239	  // Label the move from the actor's own view, so a card only it can see still reads sensibly; everything after
   240	  // is narrated from the human's view.
   241	  const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, state.resolution.queue)
   242	  return { state: result.state, lines: [{ kind: 'ai', text: describeChoice(actorView, command) }, ...lines] }
   243	}
   244	
   245	/**
   246	 * Apply exactly ONE command for whoever is currently acting, chosen by `agent`, and return the resulting state
   247	 * with the lines it produced. Pure and React-free so the whole driver is testable headlessly (spec B-A7).
   248	 */
   249	export function stepAi(state: GameState, agent: Agent): { state: GameState; lines: LogLine[] } {
   250	  const p = actingPlayer(state)
   251	  if (p === null) return { state, lines: [] }
   252	  const actorView = viewFor(state, p)
   253	  const legal = legalCommands(state, p)
   254	  return narrateApply(state, actorView, legal, agent.decide(actorView, legal))
   255	}
   256	
   257	// --- the browser's opponent: SO-ISMCTS in a worker (spec D2) -----------------------------------------------
   258	
   259	/** Everything the AI wiring needs from React. Named so the wiring below is drivable without a DOM. */
   260	export interface AiSink {
   261	  commit(state: GameState, lines: LogLine[]): void
   262	  log(line: LogLine): void
   263	}
   264	
   265	/**
   266	 * The hook's side of the coordinator contract. Every race — staleness, pacing, worker death, the fallback — is
   267	 * the coordinator's, so what is left here is only the shape the hook already had: re-check the command against
   268	 * the exact state it was chosen for, narrate it, commit it.
   269	 */
   270	export function aiHandlers(sink: AiSink): SearchRequestHandlers {
   271	  return {
   272	    onCommand: (command, forState) => {
   273	      const legal = legalCommands(forState, AI)
   274	      // `false` is load-bearing beyond skipping the commit: it is what stops the per-position seed advancing,
   275	      // so the next search of this same board asks the identical question (D2-3). Refuse rather than throw —
   276	      // this runs from a timer, where an uncaught throw would take the page down instead of the move.
   277	      if (!legal.some((c) => sameCommand(c, command))) {
   278	        sink.log({ kind: 'warning', text: `The AI chose ${command.type}, which is not legal in this position — the move was discarded` })
   279	        return false
   280	      }
   281	      const stepped = narrateApply(forState, viewFor(forState, AI), legal, command)
   282	      sink.commit(stepped.state, stepped.lines)
   283	      return true
   284	    },
   285	    // D2-6, and the reason the rung has a visible warning at all: an opponent quietly a tenth as strong is
   286	    // exactly the degradation that survives a rung unnoticed. The coordinator emits this at most once a game.
   287	    onWarning: (text) => { sink.log({ kind: 'warning', text }) },
   288	  }
   289	}
   290	
   291	/** Test seams. The hook passes none of them; the browser gets a real worker and a real clock. */
   292	export type SearchSeams = Pick<SearchCoordinatorOptions, 'createTransport' | 'clock' | 'iterations'>
   293	
   294	export interface AiSearch {
   295	  request(state: GameState, handlers: SearchRequestHandlers): void
   296	  /** Effect cleanup, and any commit the coordinator did not itself make. Synchronous, per D2-4. */
   297	  invalidate(): void
   298	  /** A new game under `seed`. */
   299	  restart(seed: number): void
   300	  dispose(): void
   301	}
   302	
   303	/**
   304	 * One `SearchCoordinator` per GAME. Throwing it away is how a restart resets the two things that are per-game
   305	 * facts and would otherwise leak across one: the committed-decision index the search seed is derived from
   306	 * (D2-3), and the permanently-Greedy latch a dead worker sets (D2-6).
   307	 *
   308	 * Built lazily, and rebuilt after `dispose`, because StrictMode's mount→unmount→mount tears the coordinator
   309	 * down without re-rendering — a one-shot construction in the render body would leave the second mount holding
   310	 * a terminated worker and no AI at all.
   311	 */
   312	export function createAiSearch(readState: () => GameState, seed: number, seams: SearchSeams = {}): AiSearch {
   313	  let gameSeed = seed
   314	  let coordinator: SearchCoordinator | null = null
   315	  const drop = (): void => { coordinator?.dispose(); coordinator = null }
   316	  const live = (): SearchCoordinator => (coordinator ??= new SearchCoordinator({
   317	    decks: DECKS, gameSeed, readState, stepMs: AI_STEP_MS, ...seams,
   318	  }))
   319	  return {
   320	    request: (state, handlers) => { live().request(state, handlers) },
   321	    invalidate: () => { coordinator?.invalidate() },
   322	    restart: (next) => { gameSeed = next; drop() },
   323	    dispose: drop,
   324	  }
   325	}
   326	
   327	const newGame = (seed: number): GameState => createGame({ seed, decks: DECKS, defs: CARD_DEFS })
   328	
   329	const openingLog = (): LogLine[] => [{ kind: 'phase', text: 'New game — you are P0, the AI is P1' }]
   330	
   331	export function useGame(seed?: number): GameApi {
   332	  const seedRef = useRef<number>(seed ?? Date.now() % 2_147_483_647)
   333	  // Spec B3: the ground truth lives here and only `viewFor(state, HUMAN)` ever leaves the hook. `stateRef` is
   334	  // the authority `choose` reads, so two clicks inside one render can't both apply to the same stale state.
   335	  const [state, setState] = useState<GameState>(() => newGame(seedRef.current))
   336	  const stateRef = useRef<GameState>(state)
   337	  const searchRef = useRef<AiSearch | null>(null)
   338	  // Lazy for the same reason the game itself is: `useRef(createAiSearch(...))` would build one every render.
   339	  searchRef.current ??= createAiSearch(() => stateRef.current, seedRef.current)
   340	  const [log, setLog] = useState<LogLine[]>(openingLog)
   341	  const [aiThinking, setAiThinking] = useState(false)
   342	
   343	  const commit = useCallback((next: GameState, lines: LogLine[]) => {
   344	    stateRef.current = next
   345	    setState(next)
   346	    if (lines.length) setLog((prev) => [...prev, ...lines])
   347	  }, [])
   348	
   349	  const appendLog = useCallback((line: LogLine) => { setLog((prev) => [...prev, line]) }, [])
   350	  const handlers = useMemo(() => aiHandlers({ commit, log: appendLog }), [commit, appendLog])
   351	
   352	  const view = useMemo(() => viewFor(state, HUMAN), [state])
   353	  const choices = useMemo(() => buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN))), [state, view])
   354	
   355	  const choose = useCallback((choice: Choice): void => {
   356	    const current = stateRef.current
   357	    // Spec B-A4: prove the command is still legal before touching `apply`, so an illegal click is impossible
   358	    // rather than merely rejected by the engine after the fact.
   359	    //
   360	    // This check comes BEFORE the invalidation, and the order matters. Invalidating first meant a stale click
   361	    // that turned out to be illegal had already cancelled the AI's outstanding search on its way to throwing:
   362	    // state unchanged, nothing outstanding, and no reason for the state-keyed effect to request again — the
   363	    // AI simply stopped. Nothing happens between these two statements, so there is no window to protect.
   364	    const legal = legalCommands(current, HUMAN)
   365	    if (!legal.some((c) => sameCommand(c, choice.command))) throw new Error(`illegal command: ${choice.label}`)
   366	    // D2-4: an external commit synchronously drops whatever the AI has outstanding. `concede` is legal even
   367	    // when the human is NOT the acting player, so a click really can land in the middle of the AI's search.
   368	    searchRef.current?.invalidate()
   369	    const before = viewFor(current, HUMAN)
   370	    const result = apply(current, choice.command)
   371	    const lines = eventLines(narrator(before, viewFor(result.state, HUMAN)), result.events, current.resolution.queue)
   372	    commit(result.state, [{ kind: 'human', text: describeChoice(before, choice.command) }, ...lines])
   373	  }, [commit])
   374	
   375	  const restart = useCallback((): void => {
   376	    // A fresh but reproducible seed: `useGame(seed)` stays deterministic across restarts, which tests rely on.
   377	    const next = ++seedRef.current
   378	    const game = newGame(next)
   379	    stateRef.current = game
   380	    // D2-3: a new coordinator, so the committed-decision index the search seed is derived from restarts at 0.
   381	    searchRef.current?.restart(next)
   382	    setState(game)
   383	    setLog(openingLog())
   384	    setAiThinking(false)
   385	  }, [])
   386	
   387	  // Spec B7 + D2: one AI move per decision, searched off the main thread. Re-running on every `state` change is
   388	  // what makes it a loop, and one accepted request per state is what stops two AI moves overlapping. The
   389	  // cleanup invalidates synchronously, so StrictMode's mount→unmount→mount double-invoke discards the first
   390	  // request rather than stepping the AI twice.
   391	  useEffect(() => {
   392	    if (state.result || actingPlayer(state) !== AI) { setAiThinking(false); return }
   393	    setAiThinking(true)
   394	    const search = searchRef.current as AiSearch
   395	    search.request(state, handlers)
   396	    return () => { search.invalidate() }
   397	  }, [state, handlers])
   398	
   399	  // Unmount only. A worker outliving its hook is both a leak and a source of replies for a game nobody is
   400	  // looking at any more (D2-4).
   401	  // Layout, not passive: passive cleanup runs AFTER the DOM is gone, so a worker result queued in between
   402	  // would be processed — and could even schedule a zero-delay delivery — against an unmounted component.
   403	  // Disposal has to be synchronous with unmount, the same way every other invalidation here is.
   404	  useLayoutEffect(() => () => { searchRef.current?.dispose() }, [])
   405	
   406	  return { view, choices, log, aiThinking, choose, restart }
   407	}

exec
/bin/zsh -lc "rg -n \"abilityTriggered|abilityActivated|activates|triggers|paidToBreakZone|reason.*cost|preferredPaymentFor|activationCheck|activateAbility\" packages/engine/test/activated-abilities.test.ts packages/ai/test/greedy.test.ts apps/web/test/commands.test.ts apps/web/test/useGame.test.ts apps/cli/test/agents.test.ts packages/ai/test/ismcts-keys.test.ts packages/cards/test/abilities.test.ts && nl -ba packages/engine/test/activated-abilities.test.ts && nl -ba packages/cards/test/abilities.test.ts | sed -n '1,240p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
apps/cli/test/agents.test.ts:133:      if (command.type === 'activateAbility') chosen.set(command.abilityId, (chosen.get(command.abilityId) ?? 0) + 1)
packages/engine/test/activated-abilities.test.ts:9:import { activationCheck } from '../src/activate.js'
packages/engine/test/activated-abilities.test.ts:51:  apply(s, { type: 'activateAbility', player: 0, source, abilityId, payment })
packages/engine/test/activated-abilities.test.ts:101:    expect(activationCheck(s, 0, src, 'T-PUMP:act')).toMatch(/no legal target/)
packages/engine/test/activated-abilities.test.ts:102:    expect(legalCommands(s, 0).some((c) => c.type === 'activateAbility')).toBe(false)
packages/engine/test/activated-abilities.test.ts:144:    expect(r.events.some((e) => e.type === 'paidToBreakZone')).toBe(true)
packages/engine/test/activated-abilities.test.ts:168:    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toMatch(/already dull/)
packages/engine/test/activated-abilities.test.ts:176:    expect(activationCheck(s, 0, fresh, 'T-DULLCOST:act')).toMatch(/entered the field this turn/)
packages/engine/test/activated-abilities.test.ts:177:    expect(activationCheck(s, 0, hasted, 'T-DULLCOST:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:187:    expect(activationCheck(s, 0, src, 'T-NODULL:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:198:    const offered = legalCommands(s, 0).filter((c) => c.type === 'activateAbility')
packages/engine/test/activated-abilities.test.ts:200:      if (c.type !== 'activateAbility') continue
packages/engine/test/activated-abilities.test.ts:210:    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:211:    expect(activationCheck({ ...s, phase: 'attack' }, 0, src, 'T-DULLCOST:act')).toMatch(/Main Phase/)
packages/engine/test/activated-abilities.test.ts:212:    expect(activationCheck({ ...s, turnPlayer: 1 }, 0, src, 'T-DULLCOST:act')).toMatch(/your own turn/)
packages/engine/test/activated-abilities.test.ts:224:    expect(activationCheck(s, 0, handId, 'T-HAND:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:225:    expect(activationCheck(s, 0, fieldId, 'T-FIELD:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:227:    expect(activationCheck(s, 0, strayField, 'T-HAND:act')).toMatch(/only be used from your hand/)
packages/engine/test/activated-abilities.test.ts:256:    const acts = legalCommands(s, 0).filter((c) => c.type === 'activateAbility')
packages/engine/test/activated-abilities.test.ts:257:    expect(acts.map((c) => (c.type === 'activateAbility' ? c.abilityId : '')).sort())
apps/web/test/commands.test.ts:159:    const PAYABLE = ['castCharacter', 'castSummon', 'activateAbility']
apps/web/test/commands.test.ts:393:// Observer triggers (rung C2)
apps/web/test/commands.test.ts:463:    ({ type: 'activateAbility', player: HUMAN, source, abilityId, payment })
apps/web/test/commands.test.ts:470:    expect(set.byCard.get(src)?.map((c) => c.command.type)).toEqual(['activateAbility'])
packages/ai/test/greedy.test.ts:398:          triggered += r.events.filter((e) => e.type === 'abilityTriggered').length
packages/ai/test/greedy.test.ts:428:describe('C2: observer triggers reach the agent', () => {
packages/ai/test/greedy.test.ts:543:        observed += r.events.filter((e) => e.type === 'abilityTriggered' && e.abilityId.endsWith(':broken')).length
apps/web/test/useGame.test.ts:302:    const line = describeEvent(view, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: THREE_MODES.id })
apps/web/test/useGame.test.ts:341:    expect(describeEvent(v, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: multi.id })?.text).toContain('Line one. Line two.')
apps/web/test/useGame.test.ts:381:    expect(log.some((l) => l.text.includes("ability triggers"))).toBe(true)
apps/web/test/useGame.test.ts:444:// Observer triggers (rung C2)
apps/web/test/useGame.test.ts:479:const triggered = (player: PlayerId, card: CardId, abilityId: string): Event => ({ type: 'abilityTriggered', player, card, abilityId })
apps/web/test/useGame.test.ts:485:    expect(out[1]).toContain("Lightning's ability triggers — the AI's Prishe was broken")
apps/web/test/useGame.test.ts:490:  it('C2-A3: two simultaneous breaks give two triggers that name DIFFERENT cards', () => {
apps/web/test/useGame.test.ts:518:    expect(out[1]?.startsWith('Lightning\'s ability triggers: "EX BURST')).toBe(true)
apps/web/test/useGame.test.ts:560:      expect(out[1]).toContain("Luso's ability triggers — Luso dealt 3000 damage to Prishe")
apps/web/test/useGame.test.ts:570:    const trigger = (out: string[]): number => out.findIndex((t) => t.includes('ability triggers'))
apps/web/test/useGame.test.ts:605:  // Seek COVERAGE, not a count. This used to stop at `caused.length >= 2`, which two Lightning triggers
apps/web/test/useGame.test.ts:610:    ['Luso', (t) => t.includes("Luso's ability triggers — Luso dealt")],
apps/web/test/useGame.test.ts:611:    ['Lightning', (t) => t.includes("Lightning's ability triggers — ") && t.includes('was broken')],
apps/web/test/useGame.test.ts:621:        if (l.text.includes('ability triggers — ')) caused.push(l.text)
apps/web/test/useGame.test.ts:636:    for (const line of caused) expect(line).toMatch(/ability triggers — .+: ".+"/)
packages/cards/test/abilities.test.ts:287:    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: ramuh, abilityId: '20-103H:summon' })
packages/cards/test/abilities.test.ts:360:    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: prishe, abilityId: '22-068R:damages-opponent' })
packages/cards/test/abilities.test.ts:410:    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: luso, abilityId: '27-125S:damages-opponent' })
packages/cards/test/abilities.test.ts:433:    expect(t.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: luso, abilityId: '27-125S:damages-forward' })
     1	import { describe, expect, it } from 'vitest'
     2	import type { CardDef } from '../src/types.js'
     3	import type { CardId, GameState } from '../src/state.js'
     4	import type { Ability, AbilityCost, Effect } from '../src/abilities.js'
     5	import type { Payment } from '../src/commands.js'
     6	import { describeAbilityCost } from '../src/abilities.js'
     7	import { apply } from '../src/apply.js'
     8	import { legalCommands } from '../src/legal.js'
     9	import { activationCheck } from '../src/activate.js'
    10	import { IllegalCommandError } from '../src/errors.js'
    11	import { deckOf, makeDef, makeGame, VANILLA_POOL, withField, withHand } from './helpers.js'
    12	
    13	/**
    14	 * Rung C3 — the activation transaction, tested on synthetic cards.
    15	 *
    16	 * Synthetic on purpose: these are assertions about cost atomicity, trigger ordering and legality, not about
    17	 * Red Mage. The printed cards get their own tests in `packages/cards`, where the AST is checked against the
    18	 * printed wording.
    19	 */
    20	
    21	const NO_PAY: Payment = { dullBackups: [], discards: [] }
    22	
    23	function actionCard(code: string, cost: AbilityCost, effects: readonly Effect[], over: Partial<CardDef> = {}): CardDef {
    24	  const ability: Ability = { id: `${code}:act`, trigger: { kind: 'activated', sourceZone: over.type === 'backup' ? 'field' : 'field', cost }, text: 'synthetic activated clause', effects }
    25	  return makeDef({ code, cost: 1, power: 5000, hasAbilities: true, abilityClauses: 1, text: 'synthetic', abilities: [ability], ...over })
    26	}
    27	
    28	/** A card whose ability is usable only from hand — the `sourceZone` precondition (spec C3-3). */
    29	function handCard(code: string, cost: AbilityCost, effects: readonly Effect[]): CardDef {
    30	  const ability: Ability = { id: `${code}:act`, trigger: { kind: 'activated', sourceZone: 'hand', cost }, text: 'synthetic hand clause', effects }
    31	  return makeDef({ code, cost: 1, power: 5000, hasAbilities: true, abilityClauses: 1, text: 'synthetic', abilities: [ability] })
    32	}
    33	
    34	/** A watcher of "a Forward opponent controls is put from the field into the Break Zone" — Lightning's shape. */
    35	function watcherCard(code: string, effects: readonly Effect[]): CardDef {
    36	  const ability: Ability = {
    37	    id: `${code}:watch`,
    38	    trigger: { kind: 'observesZoneChange', from: 'field', to: 'breakZone', whose: 'opponent', of: 'forward' },
    39	    text: 'synthetic observer clause',
    40	    effects,
    41	  }
    42	  return makeDef({ code, cost: 1, power: 5000, hasAbilities: true, abilityClauses: 1, text: 'synthetic', abilities: [ability] })
    43	}
    44	
    45	function gameWith(defs: CardDef[]): GameState {
    46	  const pool = [...VANILLA_POOL, ...defs]
    47	  return makeGame({ defs: pool, decks: [deckOf(VANILLA_POOL.map((d) => d.code)), deckOf(VANILLA_POOL.map((d) => d.code))] })
    48	}
    49	
    50	const activate = (s: GameState, source: CardId, abilityId: string, payment = NO_PAY) =>
    51	  apply(s, { type: 'activateAbility', player: 0, source, abilityId, payment })
    52	
    53	// ---------------------------------------------------------------------------
    54	// C3-A2 — the cost removes the source, and the effect still resolves in full
    55	// ---------------------------------------------------------------------------
    56	
    57	describe('cost and effect are separate (C3-A2)', () => {
    58	  it('resolves in full even though the cost already put the source into the Break Zone', () => {
    59	    // Noel's shape: dull AND self-break as the cost, then "dull all the Forwards opponent controls".
    60	    const def = actionCard('T-SELFBREAK', { dull: true, selfToBreakZone: true },
    61	      [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'dull' }] }])
    62	    let s = gameWith([def])
    63	    let src: CardId; let a: CardId; let b: CardId
    64	    ;[s, src] = withField(s, 0, 'forwards', 'T-SELFBREAK')
    65	    ;[s, a] = withField(s, 1, 'forwards', 'V-F1')
    66	    ;[s, b] = withField(s, 1, 'forwards', 'V-F2')
    67	
    68	    const r = activate(s, src, 'T-SELFBREAK:act')
    69	    // The source is gone...
    70	    expect(r.state.players[0].forwards.some((c) => c.id === src)).toBe(false)
    71	    expect(r.state.players[0].breakZone).toContain(src)
    72	    // ...and every opponent Forward was still dulled by the ability it paid for.
    73	    expect(r.state.players[1].forwards.find((c) => c.id === a)?.status).toBe('dull')
    74	    expect(r.state.players[1].forwards.find((c) => c.id === b)?.status).toBe('dull')
    75	  })
    76	
    77	  it('a targeted effect resolves against the POST-cost board, so the source cannot target itself', () => {
    78	    // Undead Princess's shape. She is in the Break Zone by the time targets are offered.
    79	    const def = actionCard('T-PUMP', { selfToBreakZone: true },
    80	      [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }])
    81	    let s = gameWith([def])
    82	    let src: CardId; let ally: CardId
    83	    ;[s, src] = withField(s, 0, 'forwards', 'T-PUMP')
    84	    ;[s, ally] = withField(s, 0, 'forwards', 'V-F1')
    85	
    86	    const r = activate(s, src, 'T-PUMP:act')
    87	    expect(r.state.pending?.kind).toBe('chooseTargets')
    88	    const candidates = r.state.pending?.kind === 'chooseTargets' ? r.state.pending.candidates : []
    89	    expect(candidates).toEqual([ally])
    90	    expect(candidates).not.toContain(src)
    91	  })
    92	
    93	  it('is ILLEGAL, rather than a cost paid for nothing, when the ability has no legal target', () => {
    94	    // The source is the only Forward, so once she pays there is nothing to pump (§11.6.5).
    95	    const def = actionCard('T-PUMP', { selfToBreakZone: true },
    96	      [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'addPower', amount: 4000 }] }])
    97	    let s = gameWith([def])
    98	    let src: CardId
    99	    ;[s, src] = withField(s, 0, 'forwards', 'T-PUMP')
   100	
   101	    expect(activationCheck(s, 0, src, 'T-PUMP:act')).toMatch(/no legal target/)
   102	    expect(legalCommands(s, 0).some((c) => c.type === 'activateAbility')).toBe(false)
   103	    expect(() => activate(s, src, 'T-PUMP:act')).toThrow(IllegalCommandError)
   104	    // And nothing was spent finding that out.
   105	    expect(s.players[0].breakZone).not.toContain(src)
   106	  })
   107	})
   108	
   109	// ---------------------------------------------------------------------------
   110	// C3-A3 / C3-A4 — the cost's own zone movement
   111	// ---------------------------------------------------------------------------
   112	
   113	describe('a self-break cost is a zone movement but NOT a break (C3-A3/C3-A4)', () => {
   114	  const setup = () => {
   115	    // The action draws for player 0; the opponent's watcher draws for player 1. `drew.player` tells the two
   116	    // apart, so the EVENT ORDER answers "which resolved first".
   117	    const action = actionCard('T-ACT', { selfToBreakZone: true }, [{ kind: 'draw', count: 1 }])
   118	    const watcher = watcherCard('T-WATCH', [{ kind: 'draw', count: 1 }])
   119	    let s = gameWith([action, watcher])
   120	    let src: CardId
   121	    ;[s, src] = withField(s, 0, 'forwards', 'T-ACT')
   122	    ;[s] = withField(s, 1, 'forwards', 'T-WATCH')
   123	    return { s, src }
   124	  }
   125	
   126	  it('fires the opponent watcher BEFORE the ability the cost paid for (FIFO agenda)', () => {
   127	    const { s, src } = setup()
   128	    const r = activate(s, src, 'T-ACT:act')
   129	    const draws = r.events.filter((e) => e.type === 'drew').map((e) => (e as { player: number }).player)
   130	    // The cost's trigger is enqueued ahead of the action frame, so player 1 draws first.
   131	    expect(draws).toEqual([1, 0])
   132	  })
   133	
   134	  it('emits no break event for the cost, and does not consult cannotBeBroken', () => {
   135	    const action = actionCard('T-ACT', { selfToBreakZone: true }, [{ kind: 'draw', count: 1 }])
   136	    let s = gameWith([action])
   137	    let src: CardId
   138	    // `cannotBeBroken` would stop `breakCard` dead. A cost is not a break (§15.1.1.3.2), so it must not care.
   139	    ;[s, src] = withField(s, 0, 'forwards', 'T-ACT', { flags: ['cannotBeBroken'] })
   140	
   141	    const r = activate(s, src, 'T-ACT:act')
   142	    expect(r.state.players[0].breakZone).toContain(src)
   143	    expect(r.events.some((e) => e.type === 'brokenByAbility' || e.type === 'broken' || e.type === 'breakPrevented')).toBe(false)
   144	    expect(r.events.some((e) => e.type === 'paidToBreakZone')).toBe(true)
   145	  })
   146	
   147	  it('still reaches an observer of "put from the field into the Break Zone"', () => {
   148	    // The half that is easy to get backwards: not-a-break does NOT mean not-a-movement. The implemented
   149	    // watcher's printed wording is about the movement, so it must see this.
   150	    const { s, src } = setup()
   151	    const r = activate(s, src, 'T-ACT:act')
   152	    expect(r.events.filter((e) => e.type === 'drew').some((e) => (e as { player: number }).player === 1)).toBe(true)
   153	  })
   154	})
   155	
   156	// ---------------------------------------------------------------------------
   157	// C3-A5 — legality, constructed rather than swept for
   158	// ---------------------------------------------------------------------------
   159	
   160	describe('activation legality (C3-A5)', () => {
   161	  const dullCost: AbilityCost = { dull: true }
   162	  const dullDef = () => actionCard('T-DULLCOST', dullCost, [{ kind: 'draw', count: 1 }])
   163	
   164	  it('a [Dull] cost needs an ACTIVE source', () => {
   165	    let s = gameWith([dullDef()])
   166	    let src: CardId
   167	    ;[s, src] = withField(s, 0, 'forwards', 'T-DULLCOST', { status: 'dull' })
   168	    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toMatch(/already dull/)
   169	  })
   170	
   171	  it('a [Dull] cost is illegal the turn its source entered, and legal with Haste (§11.6.2.2)', () => {
   172	    let s = gameWith([dullDef()])
   173	    let fresh: CardId; let hasted: CardId
   174	    ;[s, fresh] = withField(s, 0, 'forwards', 'T-DULLCOST', { enteredTurn: s.turn })
   175	    ;[s, hasted] = withField(s, 0, 'forwards', 'T-DULLCOST', { enteredTurn: s.turn, granted: ['haste'] })
   176	    expect(activationCheck(s, 0, fresh, 'T-DULLCOST:act')).toMatch(/entered the field this turn/)
   177	    expect(activationCheck(s, 0, hasted, 'T-DULLCOST:act')).toBeNull()
   178	  })
   179	
   180	  it('WITHOUT a [Dull] icon, a dulled source that entered this turn is still legal', () => {
   181	    // Undead Princess. The restriction rides on the icon, not on activation in general — revision 1 of the
   182	    // spec had this wrong and would have made her unusable the turn she arrives.
   183	    const def = actionCard('T-NODULL', { selfToBreakZone: true }, [{ kind: 'draw', count: 1 }])
   184	    let s = gameWith([def])
   185	    let src: CardId
   186	    ;[s, src] = withField(s, 0, 'forwards', 'T-NODULL', { status: 'dull', enteredTurn: s.turn })
   187	    expect(activationCheck(s, 0, src, 'T-NODULL:act')).toBeNull()
   188	  })
   189	
   190	  it('the source may not pay its own CP cost, as a dulled Backup or as a discard (C3-5)', () => {
   191	    const def = actionCard('T-CP', { cp: { amount: 1, requiredElements: ['earth'] }, dull: true }, [{ kind: 'draw', count: 1 }], { type: 'backup', power: null })
   192	    let s = gameWith([def])
   193	    let src: CardId
   194	    ;[s, src] = withField(s, 0, 'backups', 'T-CP')
   195	    // Dulling itself would pay the [Earth] AND the [Dull] with one action.
   196	    expect(() => activate(s, src, 'T-CP:act', { dullBackups: [src], discards: [] })).toThrow(IllegalCommandError)
   197	    // And no enumerated payment offers it either.
   198	    const offered = legalCommands(s, 0).filter((c) => c.type === 'activateAbility')
   199	    for (const c of offered) {
   200	      if (c.type !== 'activateAbility') continue
   201	      expect(c.payment.dullBackups).not.toContain(src)
   202	      expect(c.payment.discards.map((d) => d.card)).not.toContain(src)
   203	    }
   204	  })
   205	
   206	  it('is illegal outside the turn player\'s Main Phases (MVP0-SIMPLIFICATION C3-11)', () => {
   207	    let s = gameWith([dullDef()])
   208	    let src: CardId
   209	    ;[s, src] = withField(s, 0, 'forwards', 'T-DULLCOST')
   210	    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toBeNull()
   211	    expect(activationCheck({ ...s, phase: 'attack' }, 0, src, 'T-DULLCOST:act')).toMatch(/Main Phase/)
   212	    expect(activationCheck({ ...s, turnPlayer: 1 }, 0, src, 'T-DULLCOST:act')).toMatch(/your own turn/)
   213	  })
   214	
   215	  it('honours sourceZone: a hand ability is unusable from the field and vice versa', () => {
   216	    const inHand = handCard('T-HAND', { selfDiscard: true }, [{ kind: 'draw', count: 1 }])
   217	    const onField = actionCard('T-FIELD', { dull: true }, [{ kind: 'draw', count: 1 }])
   218	    let s = gameWith([inHand, onField])
   219	    let handId: CardId; let fieldId: CardId; let strayField: CardId
   220	    ;[s, handId] = withHand(s, 0, 'T-HAND')
   221	    ;[s, fieldId] = withField(s, 0, 'forwards', 'T-FIELD')
   222	    ;[s, strayField] = withField(s, 0, 'forwards', 'T-HAND')
   223	
   224	    expect(activationCheck(s, 0, handId, 'T-HAND:act')).toBeNull()
   225	    expect(activationCheck(s, 0, fieldId, 'T-FIELD:act')).toBeNull()
   226	    // The same card on the field cannot use its hand-only ability.
   227	    expect(activationCheck(s, 0, strayField, 'T-HAND:act')).toMatch(/only be used from your hand/)
   228	  })
   229	
   230	  it('discarding from hand as a cost moves the source to the Break Zone and draws', () => {
   231	    const def = handCard('T-HAND', { selfDiscard: true }, [{ kind: 'draw', count: 1 }])
   232	    let s = gameWith([def])
   233	    let handId: CardId
   234	    ;[s, handId] = withHand(s, 0, 'T-HAND')
   235	    const before = s.players[0].hand.length
   236	
   237	    const r = activate(s, handId, 'T-HAND:act')
   238	    expect(r.state.players[0].breakZone).toContain(handId)
   239	    expect(r.state.players[0].hand).not.toContain(handId)
   240	    // -1 for the discarded source, +1 for the draw.
   241	    expect(r.state.players[0].hand.length).toBe(before)
   242	  })
   243	})
   244	
   245	// ---------------------------------------------------------------------------
   246	// Enumeration and labelling
   247	// ---------------------------------------------------------------------------
   248	
   249	describe('activations are enumerated and labelled', () => {
   250	  it('legalCommands offers one activation per clause, from every source zone', () => {
   251	    const field = actionCard('T-FIELD', { dull: true }, [{ kind: 'draw', count: 1 }])
   252	    const hand = handCard('T-HAND', { selfDiscard: true }, [{ kind: 'draw', count: 1 }])
   253	    let s = gameWith([field, hand])
   254	    ;[s] = withField(s, 0, 'forwards', 'T-FIELD')
   255	    ;[s] = withHand(s, 0, 'T-HAND')
   256	    const acts = legalCommands(s, 0).filter((c) => c.type === 'activateAbility')
   257	    expect(acts.map((c) => (c.type === 'activateAbility' ? c.abilityId : '')).sort())
   258	      .toEqual(['T-FIELD:act', 'T-HAND:act'])
   259	  })
   260	
   261	  it('renders the printed cost the way the card prints it', () => {
   262	    expect(describeAbilityCost({ cp: { amount: 1, requiredElements: ['lightning'] }, dull: true })).toBe('[Lightning][Dull]')
   263	    expect(describeAbilityCost({ cp: { amount: 2 }, dull: true, selfToBreakZone: true })).toBe('[2][Dull], put into the Break Zone')
   264	    expect(describeAbilityCost({ selfToBreakZone: true })).toBe('put into the Break Zone')
   265	    expect(describeAbilityCost({ cp: { amount: 0 } })).toBe('[0]')
   266	  })
   267	})
     1	import { readFileSync } from 'node:fs'
     2	import { dirname, join } from 'node:path'
     3	import { fileURLToPath } from 'node:url'
     4	import { describe, expect, it } from 'vitest'
     5	import type { CardDef, CardId, FieldCard, GameState, PlayerId } from '@fftcg/engine'
     6	import { apply, applyChooseFirst, applyMulligan, checkInvariants, createGame, defOf, findFieldCard, legalCommands, powerOf } from '@fftcg/engine'
     7	import { ABILITIES, ABILITY_CLAUSES, loadCards } from '../src/index.js'
     8	
     9	/**
    10	 * The five rung-C1 clauses, tested against the REAL defs from `loadCards()` and the printed text quoted in
    11	 * each `it(…)` name (spec C1-A1). The engine's own `abilities-engine.test.ts` proves the executor with
    12	 * synthetic defs; this file proves that the hand-written ASTs encode what the cards actually say.
    13	 *
    14	 * MVP0-SIMPLIFICATION (spec C1-4): every assertion below is the documented IMMEDIATE-RESOLUTION result.
    15	 * There is no stack and no response window in C1, so none of this is a claim of CR correctness.
    16	 */
    17	
    18	const DEFS = loadCards()
    19	
    20	/** 50 cards, ≤3 copies of each of the 18 codes (§8.1.1.1–2). */
    21	const DECK: string[] = (() => {
    22	  const codes = DEFS.map((d) => d.code)
    23	  const out: string[] = []
    24	  for (let i = 0; out.length < 50; i++) out.push(codes[i % codes.length] as string)
    25	  return out
    26	})()
    27	
    28	function makeGame(): GameState {
    29	  let s = createGame({ seed: 1, decks: [DECK, DECK], defs: DEFS })
    30	  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : 0
    31	  ;[s] = applyChooseFirst(s, chooser, chooser === 0)   // player 0 always goes first
    32	  ;[s] = applyMulligan(s, 0, false)
    33	  ;[s] = applyMulligan(s, 1, false)
    34	  // An empty hand keeps payments unambiguous; the cards go under the deck so no instance leaves every zone.
    35	  const p0 = s.players[0]
    36	  return { ...s, players: [{ ...p0, hand: [], deck: [...p0.deck, ...p0.hand] }, s.players[1]] }
    37	}
    38	
    39	let nextId = 90_000
    40	function addInstance(state: GameState, owner: PlayerId, code: string): [GameState, CardId] {
    41	  const id = nextId++
    42	  return [{ ...state, cards: { ...state.cards, [id]: { id, code, owner } } }, id]
    43	}
    44	function setPlayer(state: GameState, p: PlayerId, ps: GameState['players'][0]): GameState {
    45	  const players: GameState['players'] = [state.players[0], state.players[1]]
    46	  players[p] = ps
    47	  return { ...state, players }
    48	}
    49	function withField(state: GameState, player: PlayerId, zone: 'forwards' | 'backups', code: string, over: Partial<FieldCard> = {}): [GameState, CardId] {
    50	  const [s, id] = addInstance(state, player, code)
    51	  const fc: FieldCard = { id, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], ...over }
    52	  const ps = s.players[player]
    53	  return [setPlayer(s, player, { ...ps, [zone]: [...ps[zone], fc] }), id]
    54	}
    55	function withHand(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
    56	  const [s, id] = addInstance(state, player, code)
    57	  const ps = s.players[player]
    58	  return [setPlayer(s, player, { ...ps, hand: [...ps.hand, id] }), id]
    59	}
    60	function withBreakZone(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
    61	  const [s, id] = addInstance(state, player, code)
    62	  const ps = s.players[player]
    63	  return [setPlayer(s, player, { ...ps, breakZone: [...ps.breakZone, id] }), id]
    64	}
    65	
    66	/** `n` active generic Backups of one element, as CP sources. Backups produce their FIRST printed element. */
    67	const EARTH_BACKUP = '18-064C'      // Geomancer, generic
    68	const LIGHTNING_BACKUP = '18-069C'  // Red Mage, generic
    69	function withCp(state: GameState, player: PlayerId, codes: string[]): [GameState, CardId[]] {
    70	  let s = state
    71	  const ids: CardId[] = []
    72	  for (const code of codes) { let id: CardId; [s, id] = withField(s, player, 'backups', code); ids.push(id) }
    73	  return [s, ids]
    74	}
    75	
    76	const fc = (s: GameState, id: CardId): FieldCard | undefined => findFieldCard(s, id)?.card
    77	const ok = (s: GameState) => expect(checkInvariants(s)).toEqual([])
    78	const powerOfId = (s: GameState, id: CardId) => powerOf(s, fc(s, id) as FieldCard)
    79	
    80	/** Put `code` in P0's hand with exactly enough CP for it, and cast it through the real command pipeline. */
    81	function cast(state: GameState, code: string, cp: string[], type: 'castCharacter' | 'castSummon' = 'castCharacter') {
    82	  let s = state; let card: CardId; let backups: CardId[]
    83	  ;[s, card] = withHand(s, 0, code)
    84	  ;[s, backups] = withCp(s, 0, cp)
    85	  const r = apply(s, { type, player: 0, card, payment: { dullBackups: backups, discards: [] } })
    86	  return { ...r, card }
    87	}
    88	
    89	// ---------------------------------------------------------------------------
    90	// 16-092C Noel
    91	// ---------------------------------------------------------------------------
    92	
    93	describe('16-092C Noel — "EX BURST When Noel enters the field, choose up to 2 Forwards opponent controls. Dull them."', () => {
    94	  /** The EX BURST tag is C3; the trigger itself fires on a normal cast, which is what `enterField` means. */
    95	  function noelVsThree() {
    96	    let s = makeGame(); const victims: CardId[] = []
    97	    for (const code of ['27-127S', '24-063H', '22-068R']) { let id: CardId; [s, id] = withField(s, 1, 'forwards', code); victims.push(id) }
    98	    return { s, victims }
    99	  }
   100	
   101	  it('offers "up to 2" as C(3,0..2) legal answers and dulls exactly the two chosen', () => {
   102	    const { s, victims } = noelVsThree()
   103	    const r = cast(s, '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
   104	    let t = r.state
   105	    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 0, max: 2, candidates: victims })
   106	    // C1-A3: the choice is an ordinary command, so the AI plays it and the UI can click it.
   107	    expect(legalCommands(t, 0).filter((c) => c.type === 'chooseTargets')).toHaveLength(1 + 3 + 3)
   108	    ok(t)
   109	
   110	    t = apply(t, { type: 'chooseTargets', player: 0, targets: [victims[0] as CardId, victims[2] as CardId] }).state
   111	    expect(victims.map((id) => fc(t, id)?.status)).toEqual(['dull', 'active', 'dull'])
   112	    expect(t.pending).toBeNull()
   113	    ok(t)
   114	  })
   115	
   116	  it('"up to 2" means declining is legal — the empty answer dulls nothing', () => {
   117	    const { s, victims } = noelVsThree()
   118	    const t = apply(cast(s, '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP)).state, { type: 'chooseTargets', player: 0, targets: [] }).state
   119	    expect(victims.map((id) => fc(t, id)?.status)).toEqual(['active', 'active', 'active'])
   120	    ok(t)
   121	  })
   122	
   123	  it('is a logged no-op when the opponent controls no Forwards', () => {
   124	    const r = cast(makeGame(), '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
   125	    expect(r.state.pending).toBeNull()
   126	    expect(r.events).toContainEqual({ type: 'abilityNoLegalTarget', card: r.card, abilityId: '16-092C:etb' })
   127	  })
   128	
   129	  it('warns about nothing now that C3 landed its second clause', () => {
   130	    // Until rung C3 this asserted the opposite: Noel's "[Dull], put Noel into the Break Zone: Dull all the
   131	    // Forwards opponent controls." was unimplemented and the cast had to say so. Both printed clauses now
   132	    // have ASTs, so the warning must STOP — a card that keeps apologising for a clause it has is as
   133	    // dishonest as one that stays silent about a clause it lacks. Cloud and Miner still carry that half of
   134	    // the C1-9 property.
   135	    const r = cast(makeGame(), '16-092C', Array<string>(5).fill(LIGHTNING_BACKUP))
   136	    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
   137	  })
   138	})
   139	
   140	// ---------------------------------------------------------------------------
   141	// 12-120C Shantotto
   142	// ---------------------------------------------------------------------------
   143	
   144	describe('12-120C Shantotto — "When Shantotto enters the field, select 1 of the 2 following actions."', () => {
   145	  /** P0 already controls one Forward; P1 controls one. Candidate order is always player 0 then player 1. */
   146	  function shantottoOnBoard() {
   147	    let s = makeGame(); let mine: CardId, theirs: CardId
   148	    ;[s, mine] = withField(s, 0, 'forwards', '24-063H')     // Hugh Yurg 8000
   149	    ;[s, theirs] = withField(s, 1, 'forwards', '27-127S')   // Lightning 9000
   150	    const r = cast(s, '12-120C', [EARTH_BACKUP, LIGHTNING_BACKUP])
   151	    return { r, mine, theirs, shantotto: r.card }
   152	  }
   153	
   154	  it('raises the mode choice with the printed wordings as its labels', () => {
   155	    const { r } = shantottoOnBoard()
   156	    expect(r.state.pending).toEqual({
   157	      kind: 'chooseMode', player: 0, min: 1, max: 1,
   158	      labels: [
   159	        'Choose 1 Forward other than Shantotto. It gains Haste until the end of the turn.',
   160	        'Choose 1 Forward you control. It gains ‘This Forward cannot be broken’ until the end of the turn.',
   161	      ],
   162	    })
   163	    ok(r.state)
   164	  })
   165	
   166	  it('mode 1 "Choose 1 Forward other than Shantotto" excludes Shantotto itself and grants Haste', () => {
   167	    const { r, mine, theirs, shantotto } = shantottoOnBoard()
   168	    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [0] }).state
   169	    // "other than Shantotto" restricts the identity, not the controller — the opponent's Forward is legal too.
   170	    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [mine, theirs] })
   171	    t = apply(t, { type: 'chooseTargets', player: 0, targets: [mine] }).state
   172	    expect(fc(t, mine)?.granted).toEqual(['haste'])
   173	    expect(fc(t, shantotto)?.granted).toEqual([])
   174	    ok(t)
   175	  })
   176	
   177	  it('mode 2 "Choose 1 Forward you control" is self-only and grants ‘This Forward cannot be broken’', () => {
   178	    const { r, mine, theirs, shantotto } = shantottoOnBoard()
   179	    let t = apply(r.state, { type: 'chooseMode', player: 0, modes: [1] }).state
   180	    // No `excludeSource` on this mode: Shantotto may protect itself, and the opponent's Forward is not a candidate.
   181	    expect(t.pending).toEqual({ kind: 'chooseTargets', player: 0, min: 1, max: 1, candidates: [mine, shantotto] })
   182	    expect(t.pending?.kind === 'chooseTargets' && t.pending.candidates.includes(theirs)).toBe(false)
   183	    t = apply(t, { type: 'chooseTargets', player: 0, targets: [shantotto] }).state
   184	    // `cannotBeBroken` is a FieldFlag, not a Keyword — `granted` holds only real keywords (spec C1-7).
   185	    expect(fc(t, shantotto)?.flags).toEqual(['cannotBeBroken'])
   186	    expect(fc(t, shantotto)?.granted).toEqual([])
   187	    ok(t)
   188	  })
   189	
   190	  it('is fully implemented, so it warns about nothing', () => {
   191	    const { r } = shantottoOnBoard()
   192	    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
   193	  })
   194	})
   195	
   196	// ---------------------------------------------------------------------------
   197	// 27-124S Cloud
   198	// ---------------------------------------------------------------------------
   199	
   200	describe('27-124S Cloud — "When Cloud enters the field, until the end of the turn, all the Forwards you control gain 3000 power and Brave."', () => {
   201	  function cloudOnBoard() {
   202	    let s = makeGame(); let mineA: CardId, mineB: CardId, theirs: CardId
   203	    ;[s, mineA] = withField(s, 0, 'forwards', '24-063H')     // 8000
   204	    ;[s, mineB] = withField(s, 0, 'forwards', '22-068R')     // 5000
   205	    ;[s, theirs] = withField(s, 1, 'forwards', '27-127S')    // 9000
   206	    const r = cast(s, '27-124S', Array<string>(3).fill(EARTH_BACKUP))
   207	    return { r, mineA, mineB, theirs, cloud: r.card }
   208	  }
   209	
   210	  it('needs no choice at all: every Forward YOU control, Cloud included, gains 3000 power and Brave', () => {
   211	    const { r, mineA, mineB, theirs, cloud } = cloudOnBoard()
   212	    const t = r.state
   213	    expect(t.pending).toBeNull()                       // untargeted — `forEach` raises no prompt
   214	    expect(powerOfId(t, mineA)).toBe(11_000)
   215	    expect(powerOfId(t, mineB)).toBe(8000)
   216	    expect(powerOfId(t, cloud)).toBe(10_000)           // Cloud is already on the field when its own ETB resolves
   217	    expect([mineA, mineB, cloud].map((id) => fc(t, id)?.granted)).toEqual([['brave'], ['brave'], ['brave']])
   218	    expect(powerOfId(t, theirs)).toBe(9000)            // "you control" — the opponent's Forward is untouched
   219	    expect(fc(t, theirs)?.granted).toEqual([])
   220	    ok(t)
   221	  })
   222	
   223	  it('keeps warning about its unimplemented Attack-Phase clause (spec C1-9/C1-A2)', () => {
   224	    // "At the beginning of the Attack Phase during each of your turns, …" needs a phase continuation — rung C2.
   225	    const { r, cloud } = cloudOnBoard()
   226	    expect(r.events).toContainEqual({ type: 'unimplementedAbility', card: cloud, code: '27-124S', clauses: 1 })
   227	  })
   228	})
   229	
   230	// ---------------------------------------------------------------------------
   231	// 18-124C Billy Bob
   232	// ---------------------------------------------------------------------------
   233	
   234	describe('18-124C Billy Bob — "When Billy Bob enters the field, choose 1 Forward other than Card Name Billy Bob in your Break Zone. Add it to your hand."', () => {
   235	  function billyBobOnBoard() {
   236	    let s = makeGame(); let forward: CardId, otherBilly: CardId, backup: CardId, theirs: CardId
   237	    ;[s, forward] = withBreakZone(s, 0, '27-127S')     // a Forward — the only legal target
   238	    ;[s, otherBilly] = withBreakZone(s, 0, '18-124C')  // "other than Card Name Billy Bob"
   239	    ;[s, backup] = withBreakZone(s, 0, '18-064C')      // a Backup — the Break Zone is not Forwards-only
   240	    ;[s, theirs] = withBreakZone(s, 1, '24-063H')      // "your Break Zone"

exec
/bin/zsh -lc "rg -n \"Activated abilities|1-121C Red|16-092C Noel.*Dull all|18-064C|19-052C|20-074C\" packages/cards/test/abilities.test.ts && nl -ba packages/cards/test/abilities.test.ts | sed -n '440,680p'; nl -ba apps/web/test/commands.test.ts | sed -n '430,510p'; nl -ba apps/web/test/useGame.test.ts | sed -n '630,760p'; nl -ba packages/ai/test/greedy.test.ts | sed -n '540,620p'; nl -ba apps/cli/test/agents.test.ts | sed -n '100,155p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
67:const EARTH_BACKUP = '18-064C'      // Geomancer, generic
239:    ;[s, backup] = withBreakZone(s, 0, '18-064C')      // a Backup — the Break Zone is not Forwards-only
353:    ;[s, backup] = withBreakZone(s, 0, '18-064C')           // Geomancer — a Backup
403:    ;[s, backup] = withBreakZone(s, 0, '18-064C')
477:      '1-121C', '12-120C', '16-092C', '18-064C', '18-069C', '18-124C', '19-052C', '20-074C', '20-103H',
481:      '1-121C:haste', '12-120C:etb', '16-092C:dull-all', '16-092C:etb', '18-064C:draw', '18-069C:draw',
482:      '18-124C:etb', '19-052C:pump', '20-074C:draw', '20-103H:summon', '22-068R:damages-opponent',
491:    expect(ABILITY_CLAUSES['20-074C']).toBe(2)   // action landed; the ETB deck reveal is still missing
492:    expect(ABILITY_CLAUSES['19-052C']).toBe(2)   // pump landed; remove-from-game is still missing
494:    expect(ABILITY_CLAUSES['18-064C']).toBe(1)
496:    for (const code of ['20-074C', '19-052C']) {
   440	
   441	  it('c2 "up to 2" means neither action is a legal answer', () => {
   442	    const { r, theirs, backup } = lusoHits()
   443	    const t = apply(r.state, { type: 'chooseMode', player: 0, modes: [] })
   444	    expect(fc(t.state, theirs)?.damage).toBe(0)
   445	    expect(t.state.players[0].breakZone).toContain(backup)
   446	    expect(t.state.pending).toBeNull()
   447	    ok(t.state)
   448	  })
   449	
   450	  it('C2-A10: Luso and Lightning warn about nothing; Prishe keeps its one deferred clause', () => {
   451	    // Lightning costs 7, which is more CP than five Backups (§7.7.4) can make, so its coverage is asserted on
   452	    // the tables rather than on a live cast.
   453	    const missing = (code: string) => (ABILITY_CLAUSES[code] as number) - (ABILITIES[code]?.length ?? 0)
   454	    expect([missing('27-125S'), missing('27-127S'), missing('22-068R')]).toEqual([0, 0, 1])
   455	    const r = cast(makeGame(), '27-125S', [EARTH_BACKUP])
   456	    expect(r.events.some((e) => e.type === 'unimplementedAbility')).toBe(false)
   457	  })
   458	})
   459	
   460	// ---------------------------------------------------------------------------
   461	// The database wiring
   462	// ---------------------------------------------------------------------------
   463	
   464	describe('the ASTs are merged onto the fetched defs, not stored in them', () => {
   465	  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cards.json'), 'utf8')) as CardDef[]
   466	
   467	  it('data/cards.json is machine-owned and carries no hand-written ability data', () => {
   468	    // `scripts/fetch-cards.ts` regenerates that file; anything hand-written in it would be wiped by a refetch.
   469	    expect(raw.some((d) => d.abilities !== undefined || d.abilityClauses !== undefined)).toBe(false)
   470	  })
   471	
   472	  it('loadCards merges the sixteen implemented clauses on, and only those sixteen', () => {
   473	    // Five from rung C1, five from C2, six from C3's activated abilities. Any clause added without a test
   474	    // lands here first.
   475	    const implemented = DEFS.filter((d) => (d.abilities?.length ?? 0) > 0).map((d) => d.code).sort()
   476	    expect(implemented).toEqual([
   477	      '1-121C', '12-120C', '16-092C', '18-064C', '18-069C', '18-124C', '19-052C', '20-074C', '20-103H',
   478	      '22-068R', '27-124S', '27-125S', '27-127S',
   479	    ])
   480	    expect(DEFS.flatMap((d) => d.abilities ?? []).map((a) => a.id).sort()).toEqual([
   481	      '1-121C:haste', '12-120C:etb', '16-092C:dull-all', '16-092C:etb', '18-064C:draw', '18-069C:draw',
   482	      '18-124C:etb', '19-052C:pump', '20-074C:draw', '20-103H:summon', '22-068R:damages-opponent',
   483	      '27-124S:etb', '27-125S:damages-forward', '27-125S:damages-opponent',
   484	      '27-127S:etb', '27-127S:opponent-forward-broken',
   485	    ])
   486	  })
   487	
   488	  // Spec C3-A6: `ABILITY_CLAUSES` counts PRINTED clauses, implemented or not, so landing a clause must NOT
   489	  // change it. Reducing Miner from 2 to 1 would silently hide the deck-reveal clause it still does not have.
   490	  it('landing six clauses did not change any printed-clause count', () => {
   491	    expect(ABILITY_CLAUSES['20-074C']).toBe(2)   // action landed; the ETB deck reveal is still missing
   492	    expect(ABILITY_CLAUSES['19-052C']).toBe(2)   // pump landed; remove-from-game is still missing
   493	    expect(ABILITY_CLAUSES['1-121C']).toBe(1)
   494	    expect(ABILITY_CLAUSES['18-064C']).toBe(1)
   495	    // And the cards with a clause still missing must still say so.
   496	    for (const code of ['20-074C', '19-052C']) {
   497	      const def = DEFS.find((d) => d.code === code)
   498	      expect((def?.abilityClauses ?? 0) - (def?.abilities?.length ?? 0)).toBe(1)
   499	    }
   500	  })
   501	
   502	  it('every ability id is `<code>:<slug>` for a card that exists, and quotes text the card really prints', () => {
   503	    for (const def of DEFS) {
   504	      for (const ability of def.abilities ?? []) {
   505	        expect(ability.id.startsWith(`${def.code}:`), ability.id).toBe(true)
   506	        // C1-1: the AST is checked against `def.text` in review, so `text` must be a verbatim slice of it.
   507	        expect(def.text, ability.id).toContain(ability.text)
   508	      }
   509	    }
   510	    for (const code of Object.keys(ABILITIES)) expect(DEFS.some((d) => d.code === code), code).toBe(true)
   511	  })
   512	
   513	  it('every card with printed abilities declares abilityClauses, and never fewer than it implements (spec C1-9)', () => {
   514	    // Without this the engine falls back to `hasAbilities ? 1 : 0` and a partly-implemented card reports
   515	    // nothing missing — the dishonest log C1-9 forbids.
   516	    for (const def of DEFS) {
   517	      if (!def.hasAbilities) continue
   518	      expect(def.abilityClauses, def.code).toBeGreaterThanOrEqual(1)
   519	      expect(def.abilityClauses as number, def.code).toBeGreaterThanOrEqual(def.abilities?.length ?? 0)
   520	    }
   521	    for (const code of Object.keys(ABILITY_CLAUSES)) expect(DEFS.some((d) => d.code === code), code).toBe(true)
   522	  })
   523	
   524	  it('leaves everything else about a def alone', () => {
   525	    for (const def of DEFS) {
   526	      const source = raw.find((d) => d.code === def.code) as CardDef
   527	      const stripped: CardDef = { ...def }
   528	      delete stripped.abilities
   529	      delete stripped.abilityClauses
   530	      expect(stripped).toEqual(source)
   531	    }
   532	  })
   533	})
   534	
   535	/** Sanity: the defs the engine sees really do carry the ASTs, so `defOf` resolves them mid-game. */
   536	describe('defOf sees the merged abilities', () => {
   537	  it('finds Noel’s ETB through the live GameState', () => {
   538	    let s = makeGame(); let noel: CardId
   539	    ;[s, noel] = withField(s, 0, 'forwards', '16-092C')
   540	    expect(defOf(s, noel).abilities?.[0]?.id).toBe('16-092C:etb')
   541	  })
   542	})
   430	
   431	  it('names a damage cause, to a Forward or to a player', () => {
   432	    const onForward: TriggerEvent = { kind: 'damage', source: MINE, sourceController: HUMAN, target: THEIRS, victim: null, amount: 3000 }
   433	    expect(promptFor(watchView(onForward))).toBe(`Cloud dealt 3000 damage to Sphene — ${ask}`)
   434	    const onPlayer: TriggerEvent = { kind: 'damage', source: MINE, sourceController: HUMAN, target: null, victim: AI, amount: 1 }
   435	    expect(promptFor(watchView(onPlayer))).toBe(`Cloud dealt damage to the AI — ${ask}`)
   436	  })
   437	
   438	  it('says nothing extra for a clause about its own card', () => {
   439	    // `enterField`/`summonResolve` carry no trigger event: rung C1's wording is unchanged, to the character.
   440	    expect(promptFor(watchView(null))).toBe(ask)
   441	  })
   442	})
   443	
   444	describe('wording degrades gracefully when the clause cannot be read', () => {
   445	  it('falls back to neutral wording with no agenda frame behind the pending', () => {
   446	    const v = upTo2()
   447	    v.resolution = { active: null, queue: [], continuation: null, steps: 0 }
   448	    expect(promptFor(v)).toBe('Choose up to 2 Forwards the AI controls')
   449	    expect(describeChoice(v, targets([901]))).toBe('Target Cloud')
   450	  })
   451	})
   452	
   453	describe('activated abilities on the board (C3-A7)', () => {
   454	  /** A board with one Red Mage on the field, plus an unrelated Backup that could pay for its ability. */
   455	  function redMageView(): { v: PlayerView; src: CardId; backup: CardId } {
   456	    const v = viewFor(dealtGame(1), HUMAN)
   457	    const src = instance(v, 910, '1-121C')
   458	    const backup = instance(v, 911, '9-074C')
   459	    v.fields[HUMAN].backups = [fieldCard(src), fieldCard(backup)]
   460	    return { v, src, backup }
   461	  }
   462	  const act = (source: CardId, abilityId: string, payment: Payment = { dullBackups: [], discards: [] }): Command =>
   463	    ({ type: 'activateAbility', player: HUMAN, source, abilityId, payment })
   464	
   465	  it('belongs to its source card, so the board lights that card up', () => {
   466	    // Not the CP sources: those are payment, chosen for the player, and making them clickable would imply
   467	    // the click picks them.
   468	    const { v, src, backup } = redMageView()
   469	    const set = buildChoiceSet(v, [act(src, '1-121C:haste', { dullBackups: [backup], discards: [] })])
   470	    expect(set.byCard.get(src)?.map((c) => c.command.type)).toEqual(['activateAbility'])
   471	    expect(set.byCard.get(backup)).toBeUndefined()
   472	  })
   473	
   474	  it('labels the button with the printed cost', () => {
   475	    const { v, src, backup } = redMageView()
   476	    const label = describeChoice(v, act(src, '1-121C:haste', { dullBackups: [backup], discards: [] }))
   477	    expect(label).toContain('[Lightning][Dull]')
   478	  })
   479	
   480	  it('tells two clauses of the SAME card apart', () => {
   481	    // Miner and Undead Princess each print two clauses, so identity has to include the clause — the same
   482	    // reason the command carries `abilityId` rather than an index into the card's ability array.
   483	    const { src } = redMageView()
   484	    expect(sameCommand(act(src, '16-092C:etb'), act(src, '16-092C:dull-all'))).toBe(false)
   485	    expect(sameCommand(act(src, '16-092C:etb'), act(src, '16-092C:etb'))).toBe(true)
   486	  })
   487	
   488	  it('tells two payments of the same clause apart', () => {
   489	    const { src } = redMageView()
   490	    const a = act(src, '1-121C:haste', { dullBackups: [7], discards: [] })
   491	    const b = act(src, '1-121C:haste', { dullBackups: [8], discards: [] })
   492	    expect(sameCommand(a, b)).toBe(false)
   493	    expect(sameCommand(a, act(src, '1-121C:haste', { dullBackups: [7], discards: [] }))).toBe(true)
   494	  })
   495	})
   630	    for (const g of games) expect(g.state.result, 'a C2 clause dead-ended the driver').not.toBeNull()
   631	  })
   632	
   633	  it('narrates an observer trigger with its cause in a real game log', () => {
   634	    expect(caused.length, 'no shipped C2 clause ever triggered — the narration is untested').toBeGreaterThan(0)
   635	    // cause first, printed contract after: both halves, on every such line.
   636	    for (const line of caused) expect(line).toMatch(/ability triggers — .+: ".+"/)
   637	  })
   638	
   639	  it('shows both shipped C2 clauses firing across the sweep', () => {
   640	    expect([...seen].sort()).toEqual(['Lightning', 'Luso'])
   641	  })
   642	})
   643	
   644	// ---------------------------------------------------------------------------
   645	// Every target stays clickable (spec B-A4 / C2-A13)
   646	// ---------------------------------------------------------------------------
   647	
   648	const fieldCard = (id: CardId): FieldCard =>
   649	  ({ id, status: 'active', damage: 0, enteredTurn: 1, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [] })
   650	
   651	/** What the board would really hand a mouse: its markup, and the buttons in it. */
   652	function renderBoard(view: PlayerView, choices: ChoiceSet): string {
   653	  const game: GameApi = { view, choices, log: [], aiThinking: false, choose: () => undefined, restart: () => undefined }
   654	  return renderToStaticMarkup(createElement(Board, { game }))
   655	}
   656	
   657	describe('a target the board draws in no named zone is still a real button', () => {
   658	  /*
   659	   * C1 dead-ended on exactly this: Billy Bob's Break-Zone target lived in `byCard` under an id no component
   660	   * rendered, so the strip offered Concede alone while telling the player to click a highlighted card. C2-9
   661	   * widens the class — "Character" is Forward, Backup OR Monster, and both Prishe's and Luso's retrieval reach
   662	   * for one — so a BACKUP in the Break Zone is the case to prove, not another Forward.
   663	   */
   664	  const REEVE = '20-105C'
   665	  const backup: CardId = 910, onField: CardId = 911
   666	  const setup = (): { v: PlayerView; choices: ChoiceSet } => {
   667	    const v = viewFor(newGame(1), HUMAN)
   668	    v.cards[backup] = { id: backup, code: REEVE, owner: HUMAN }
   669	    v.cards[onField] = { id: onField, code: PRISHE, owner: HUMAN }
   670	    v.fields[HUMAN].breakZone = [backup]
   671	    v.fields[HUMAN].forwards = [fieldCard(onField)]
   672	    v.pending = { kind: 'chooseTargets', player: HUMAN, min: 1, max: 1, candidates: [backup] }
   673	    const choices = buildChoiceSet(v, [
   674	      { type: 'chooseTargets', player: HUMAN, targets: [backup] },
   675	      { type: 'concede', player: HUMAN },
   676	    ])
   677	    return { v, choices }
   678	  }
   679	
   680	  it('is an orphan target, and every byCard key survives into the clickable set', () => {
   681	    const { v, choices } = setup()
   682	    expect(orphanTargetIds(v, choices)).toEqual([backup])
   683	    const clickable = new Set(clickableChoices(v, choices).map((c) => c.card))
   684	    for (const id of choices.byCard.keys()) expect(clickable.has(id)).toBe(true)
   685	  })
   686	
   687	  it('renders as a <button> the human can actually press', () => {
   688	    const { v, choices } = setup()
   689	    const html = renderBoard(v, choices)
   690	    expect(html).toContain('Choose a card')   // the orphan row exists at all
   691	    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${v.defs[REEVE]!.name}[^"]*"`))
   692	    // and the strip says so: this is the exact state that offered Concede alone in C1
   693	    expect(html).toContain('click a highlighted card')
   694	    // and it is not merely present: the Forward on the field is no candidate, so it stays a plain <div>
   695	    expect(html).toMatch(new RegExp(`<div[^>]*aria-label="${v.defs[PRISHE]!.name}[^"]*"`))
   696	  })
   697	
   698	  it('leaves no clickable choice off the board across a real game', () => {
   699	    // The sweep's guard asserted DIRECTLY, rather than inferred from the driver not getting stuck.
   700	    let state = newGame(3)
   701	    const agent = new GreedyAgent({ seed: 3, decks: DECKS, depth: 1 })
   702	    let checked = 0
   703	    for (let step = 0; step < 2000 && !state.result; step++) {
   704	      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
   705	      const view = viewFor(state, HUMAN)
   706	      const choices = buildChoiceSet(view, preferredChoices(view, legalCommands(state, HUMAN)))
   707	      const usable = clickableChoices(view, choices)
   708	      const clickable = new Set(usable.map((c) => c.card))
   709	      for (const id of choices.byCard.keys()) expect(clickable.has(id), `card ${id} is targetable but unreachable`).toBe(true)
   710	      checked++
   711	      const next = usable.find((c) => c.command.type !== 'concede')
   712	      if (!next) break
   713	      state = apply(state, next.command).state
   714	    }
   715	    expect(checked).toBeGreaterThan(20)
   716	  })
   717	})
   718	
   719	// -----------------------------------------------------------------------------------------------------------
   720	// Rung D2: the AI half of the hook. There is no DOM in this suite, so what is driven here is the React-FREE
   721	// seam the effect installs — `createAiSearch` + `aiHandlers` — which is the whole of the hook's AI behaviour
   722	// minus React's own scheduling. The races behind it are asserted against the coordinator itself in
   723	// search-coordinator.test.ts; what these cover is what the HOOK adds: narration, the legality re-check, the
   724	// seed reset a restart performs, and the fallback being visible in the log a player is actually reading.
   725	// -----------------------------------------------------------------------------------------------------------
   726	
   727	const EMPTY_DIAGNOSTICS: SearchDiagnostics = {
   728	  determinisations: 1, treeApplies: 1, rolloutApplies: 1, evaluations: 1, nodes: 1, maxCommandDepth: 1, rootChildren: [],
   729	}
   730	
   731	/** Fast-forward to a position the AI actually owns — the only kind the hook ever asks about. */
   732	function aiToAct(seed: number): GameState {
   733	  let state = newGame(seed)
   734	  const agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
   735	  for (let i = 0; i < 400; i++) {
   736	    const p = actingPlayer(state)
   737	    if (p === null) break
   738	    if (p === AI) return state
   739	    state = apply(state, agent.decide(viewFor(state, p), legalCommands(state, p))).state
   740	  }
   741	  throw new Error(`seed ${seed} never reached an AI decision`)
   742	}
   743	
   744	class TestClock implements Clock {
   745	  private t = 0
   746	  private seq = 0
   747	  private readonly timers = new Map<number, { at: number; fn: () => void }>()
   748	
   749	  now(): number { return this.t }
   750	
   751	  after(ms: number, fn: () => void): () => void {
   752	    const id = ++this.seq
   753	    this.timers.set(id, { at: this.t + ms, fn })
   754	    return () => { this.timers.delete(id) }
   755	  }
   756	
   757	  advance(ms: number): void {
   758	    const target = this.t + ms
   759	    for (;;) {
   760	      let next: { id: number; at: number; fn: () => void } | null = null
   540	        }
   541	        const r = apply(s, cmd)   // an illegal answer from the policy would throw here
   542	        s = r.state
   543	        observed += r.events.filter((e) => e.type === 'abilityTriggered' && e.abilityId.endsWith(':broken')).length
   544	      }
   545	      expect(s.result, `seed ${seed} did not finish`).not.toBeNull()
   546	    }
   547	    expect(observed).toBeGreaterThan(0)   // measured 13 across the three seeds
   548	  })
   549	})
   550	
   551	// ---------------------------------------------------------------------------
   552	// Rung C3 — a bonus that EXPIRES is not worth a body
   553	// ---------------------------------------------------------------------------
   554	
   555	describe('until-end-of-turn power is discounted against permanent power (C3)', () => {
   556	  // The exact arithmetic that motivated the `temporaryPower` weight, pinned so a future re-tune cannot
   557	  // silently restore the tie. With `powerBonus` counted at the same rate as printed power:
   558	  //   losing an active 2000-power Forward  =  2×forwardPower + forwardPresence + 2×threat  =  8.0
   559	  //   giving a Forward +4000 until EOT     =  4×forwardPower              + 4×threat       =  8.0
   560	  // A dead heat, and `greedyStep` keeps the EARLIER command on a tie — so it would trade a permanent body
   561	  // for a bonus that vanishes at end of turn.
   562	  const W = DEFAULT_WEIGHTS
   563	
   564	  it('scores a permanent 2000-power body above a +4000 bonus that expires', () => {
   565	    const bodyValue = (2 * W.forwardPower) + W.forwardPresence + (2 * W.threat)
   566	    const bonusValue = (4 * W.temporaryPower) + (4 * W.threat)
   567	    expect(bodyValue).toBeGreaterThan(bonusValue)
   568	  })
   569	
   570	  it('would be an exact tie if the bonus were counted as permanent power — which is the bug', () => {
   571	    const bodyValue = (2 * W.forwardPower) + W.forwardPresence + (2 * W.threat)
   572	    const asPermanent = (4 * W.forwardPower) + (4 * W.threat)
   573	    expect(asPermanent).toBeCloseTo(bodyValue, 6)
   574	  })
   575	
   576	  it('still lets a temporary bonus count fully toward this turn\'s threat', () => {
   577	    // The bonus is discounted as MATERIAL, not as combat relevance: it really does swing a fight this turn.
   578	    let s = makeGame()
   579	    let a: CardId; let b: CardId
   580	    ;[s, a] = withField(s, 0, 'forwards', 'V-F2')
   581	    ;[s, b] = withField(s, 0, 'forwards', 'V-F2')
   582	    const flat = evaluate(s, 0, DEFAULT_WEIGHTS)
   583	    const pumped = evaluate(setBonus(s, a, 4000), 0, DEFAULT_WEIGHTS)
   584	    expect(pumped).toBeGreaterThan(flat)
   585	    // ...but by less than the same power printed on the card would be worth.
   586	    const permanent = evaluate(setBonus(s, b, 0), 0, DEFAULT_WEIGHTS)
   587	    expect(pumped - flat).toBeLessThan((4 * DEFAULT_WEIGHTS.forwardPower) + (4 * DEFAULT_WEIGHTS.threat))
   588	    expect(permanent).toBe(flat)
   589	  })
   590	})
   591	
   592	function setBonus(state: GameState, id: CardId, bonus: number): GameState {
   593	  const players = [state.players[0], state.players[1]] as typeof state.players
   594	  players[0] = { ...players[0], forwards: players[0].forwards.map((c) => (c.id === id ? { ...c, powerBonus: bonus } : c)) }
   595	  return { ...state, players }
   596	}
   100	  it('two identical runs produce identical reports (ignoring timing)', () => {
   101	    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
   102	    const opts = { games: 5, seed: 900, decks: [deck, deck] as [string[], string[]], defs: loadCards(), agents: [{ kind: 'greedy' as const }, { kind: 'random' as const }] as [AgentSpec, AgentSpec], strict: false }
   103	    const r1 = selfPlay(opts)
   104	    const r2 = selfPlay(opts)
   105	    // timing is inherently non-deterministic (wall clock); neutralize it before comparing the rest of the report
   106	    const strip = (r: typeof r1) => ({ ...r, msPerDecision: [0, 0] as [number, number] })
   107	    expect(strip(r1)).toEqual(strip(r2))
   108	  }, 60_000)
   109	})
   110	
   111	// ---------------------------------------------------------------------------
   112	// Rung C3 — the agents must actually USE activated abilities
   113	// ---------------------------------------------------------------------------
   114	
   115	describe('activated abilities reach the agents (C3-A1)', () => {
   116	  // Being legal is not enough. `candidateCommands` hand-builds the list both agents search, so a command that
   117	  // exists only in `legalCommands` is invisible to them — the plan review caught exactly that, and this is the
   118	  // test that would have failed. It asserts the agents CHOOSE an activation over a real sweep, not merely that
   119	  // one was offered.
   120	  const chosen = new Map<string, number>()
   121	  for (let seed = 1; seed <= 40 && chosen.size === 0; seed++) {
   122	    const d = decks()
   123	    const defs = loadCards()
   124	    const agents: [Agent, Agent] = [
   125	      new GreedyAgent({ seed, decks: d, depth: 1 }),
   126	      new GreedyAgent({ seed: seed + 1000, decks: d, depth: 1 }),
   127	    ]
   128	    let s = createGame({ seed, decks: d, defs })
   129	    for (let i = 0; i < 800 && !s.result; i++) {
   130	      const p = actingPlayer(s)
   131	      if (p === null) break
   132	      const command = agents[p].decide(viewFor(s, p), legalCommands(s, p))
   133	      if (command.type === 'activateAbility') chosen.set(command.abilityId, (chosen.get(command.abilityId) ?? 0) + 1)
   134	      s = apply(s, command).state
   135	    }
   136	  }
   137	
   138	  it('greedy chooses an activation at least once across the sweep', () => {
   139	    expect(chosen.size, 'no agent ever used an activated ability — they are legal but unreachable').toBeGreaterThan(0)
   140	  })
   141	
   142	  it('every activation it chose is one of the six C3 clauses', () => {
   143	    const C3 = ['1-121C:haste', '16-092C:dull-all', '18-064C:draw', '18-069C:draw', '19-052C:pump', '20-074C:draw']
   144	    for (const id of chosen.keys()) expect(C3).toContain(id)
   145	  })
   146	})

exec
/bin/zsh -lc "rg -n \"preferredPayment|enumeratePayments|minimal|40\\.2|payment\" packages/ai/test packages/engine/test | head -260 && nl -ba packages/ai/test/payment.test.ts | sed -n '1,360p' 2>/dev/null || true && nl -ba packages/engine/test/cp.test.ts | sed -n '1,360p' 2>/dev/null || true" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/engine/test/cr11.4-cast.test.ts:33:  it('rejects insufficient or wrong-element payment', () => {
packages/engine/test/activated-abilities.test.ts:50:const activate = (s: GameState, source: CardId, abilityId: string, payment = NO_PAY) =>
packages/engine/test/activated-abilities.test.ts:51:  apply(s, { type: 'activateAbility', player: 0, source, abilityId, payment })
packages/engine/test/activated-abilities.test.ts:197:    // And no enumerated payment offers it either.
packages/engine/test/activated-abilities.test.ts:201:      expect(c.payment.dullBackups).not.toContain(src)
packages/engine/test/activated-abilities.test.ts:202:      expect(c.payment.discards.map((d) => d.card)).not.toContain(src)
packages/engine/test/cr11.2-cp.test.ts:2:import { canPay, enumeratePayments, generateCp, pay, requiredElements } from '../src/cp.js'
packages/engine/test/cr11.2-cp.test.ts:59:describe('enumeratePayments', () => {
packages/engine/test/cr11.2-cp.test.ts:60:  it('lists only minimal payments and never uses the cast card, dull backups or the wrong element alone', () => {
packages/engine/test/cr11.2-cp.test.ts:62:    const ps = enumeratePayments(s, 0, target)   // earth, cost 2
packages/engine/test/cr11.2-cp.test.ts:63:    // legal minimal: {b1 + discard h1 as lightning}, {discard h2 as earth}, {b1 + discard h2 as lightning}; {b1 + h2 as earth} is NOT minimal (h2 alone pays)
packages/engine/test/cr11.2-cp.test.ts:68:    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }, { card: h2, element: 'earth' }] }) // not minimal
packages/engine/test/cr11.2-cp.test.ts:69:    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h2, element: 'earth' }] })   // h2-as-earth alone already pays → not minimal
packages/engine/test/cr11.2-cp.test.ts:76:    expect(enumeratePayments(s, 0, t)).toEqual([])
packages/ai/test/ismcts-keys.test.ts:81:    expect(isOpaque(actionKey(v, { type: 'castCharacter', player: 1, card: oppHand, payment: NO_PAYMENT }))).toBe(true)
packages/ai/test/ismcts-keys.test.ts:129:    const cmd: Command = { type: 'castCharacter', player: 1, card: id, payment: NO_PAYMENT }
packages/ai/test/ismcts-keys.test.ts:172:    const key = (v: PlayerView, id: CardId): string => actionKey(v, { type: 'castCharacter', player: 1, card: id, payment: NO_PAYMENT })
packages/ai/test/ismcts-keys.test.ts:199:      { type: 'castCharacter', player: 0, card: h, payment: { dullBackups: [b], discards: [] } },
packages/ai/test/ismcts-keys.test.ts:200:      { type: 'castSummon', player: 0, card: h, payment: { dullBackups: [b], discards: [] } },
packages/ai/test/ismcts-keys.test.ts:218:  it('sets are normalised by sorting — attackers, targets, discards, payment sources and modes', () => {
packages/ai/test/ismcts-keys.test.ts:237:      { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [b1, b2], discards: [{ card: h2, element: 'earth' }] } },
packages/ai/test/ismcts-keys.test.ts:238:      { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [b2, b1], discards: [{ card: h2, element: 'earth' }] } },
packages/ai/test/ismcts-keys.test.ts:241:    expect(actionKey(v, { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [], discards: [{ card: h2, element: 'earth' }] } }))
packages/ai/test/ismcts-keys.test.ts:242:      .not.toBe(actionKey(v, { type: 'castCharacter', player: 0, card: h1, payment: { dullBackups: [], discards: [{ card: h2, element: 'fire' }] } }))
packages/engine/test/legal-apply.test.ts:17:  it('in main phase: pass, concede, and one castCharacter per affordable card × minimal payment', () => {
packages/engine/test/legal-apply.test.ts:25:    expect(cmds).toContainEqual({ type: 'castCharacter', player: 0, card: f, payment: { dullBackups: [b], discards: [] } })
packages/engine/test/legal-apply.test.ts:55:  it('accepts a legal command that legalCommands does not list (non-minimal payment, §11.2.2.3)', () => {
packages/engine/test/legal-apply.test.ts:59:    const overpay = { type: 'castCharacter' as const, player: 0 as const, card: f, payment: { dullBackups: [b1, b2], discards: [] } }
packages/ai/test/payment.test.ts:3:import { preferredPayment } from '../src/payment.js'
packages/ai/test/payment.test.ts:6:describe('preferredPayment', () => {
packages/ai/test/payment.test.ts:13:    const p = preferredPayment(s, 0, card)!
packages/ai/test/payment.test.ts:22:    const p = preferredPayment(s, 0, card)!
packages/ai/test/payment.test.ts:33:      const p = preferredPayment(s, 0, card)!
packages/ai/test/payment.test.ts:37:  it('R5: is MINIMAL — never spends a source the payment does not need (Codex counterexample)', () => {
packages/ai/test/payment.test.ts:40:    // spending BOTH for a total of 3 CP, when the discard alone pays exactly. Worse, `enumeratePayments` only
packages/ai/test/payment.test.ts:41:    // emits MINIMAL payments, so this non-minimal result is not in `legalCommands` at all: measured over real
packages/ai/test/payment.test.ts:42:    // games, 40.2% of preferredPayment results were unusable as commands for that reason.
packages/ai/test/payment.test.ts:47:    const p = preferredPayment(s, 0, card)!
packages/ai/test/payment.test.ts:52:  it('R5: every preferredPayment result is among the minimal payments legalCommands offers', () => {
packages/ai/test/payment.test.ts:53:    // The property that makes preferredPayment usable as a UI/AI move generator at all: whatever it returns must
packages/ai/test/payment.test.ts:68:      const p = preferredPayment(s, 0, card)
packages/ai/test/payment.test.ts:71:      const match = legal.some((c) => JSON.stringify((c as { payment: unknown }).payment) === JSON.stringify(p))
packages/ai/test/payment.test.ts:72:      expect(match, `fixture ${i}: ${JSON.stringify(p)} not among ${legal.length} legal payments`).toBe(true)
packages/ai/test/payment.test.ts:80:    const p = preferredPayment(s, 0, dual)!
packages/ai/test/payment.test.ts:84:    expect(preferredPayment(t, 0, poor)).toBeNull()
packages/ai/test/payment.test.ts:98:    // has nothing left for lightning. The correct payment spends V-EARTHONLY on earth and V-DUAL on lightning.
packages/ai/test/payment.test.ts:99:    const p = preferredPayment(s, 0, target)!
packages/ai/test/payment.test.ts:108:    expect(preferredPayment(s, 0, card)).toBeNull()
packages/ai/test/payment.test.ts:127:    const p = preferredPayment(s, 0, target)
packages/ai/test/payment.test.ts:131:  it('C3: preferredPayment pays a Light card with two off-element (earth) backups, no same-element CP needed', () => {
packages/ai/test/payment.test.ts:137:    const p = preferredPayment(s, 0, card)
packages/engine/test/abilities-engine.test.ts:489:    // cost 0 so an empty payment is legal (§11.2.2.4) — this test is about §12.4.5, not about paying.
packages/engine/test/abilities-engine.test.ts:498:    const { state } = apply(s, { type: 'castCharacter', player: 0, card: src, payment: { dullBackups: [], discards: [] } })
packages/engine/test/abilities-engine.test.ts:536:    let r = apply(s, { type: 'castCharacter', player: 0, card: src, payment: { dullBackups: [], discards: [] } })
packages/engine/test/observer-triggers.test.ts:67: * Cost 0 so an empty payment is legal (§11.2.2.4) — these tests are about triggers, not about paying.
packages/engine/test/observer-triggers.test.ts:86:  return apply(s, { type: 'castSummon', player: 0, card: cast, payment: { dullBackups: [], discards: [] } })
packages/engine/test/observer-triggers.test.ts:184:      // `reason` rides on the event from C3 so narration can tell a break from a cost payment.
packages/engine/test/observer-triggers.test.ts:221: * here. `cost: 0` keeps the payment empty; the clause under test is the untouched real one.
packages/engine/test/observer-triggers.test.ts:240:  const r = apply(s, { type: 'castCharacter', player: 0, card: cast, payment: { dullBackups: [], discards: [] } })
packages/engine/test/observer-triggers.test.ts:328:    let r = apply(s, { type: 'castCharacter', player: 0, card: cast, payment: { dullBackups: [], discards: [] } })
     1	import { describe, expect, it } from 'vitest'
     2	import { canPay, defOf, generateCp, legalCommands } from '@fftcg/engine'
     3	import { preferredPayment } from '../src/payment.js'
     4	import { VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'
     5	
     6	describe('preferredPayment', () => {
     7	  it('dulls matching backups before discarding, and the result satisfies canPay', () => {
     8	    let s = withHandSize(makeGame(), 0, 0); let b1: number, b2: number, card: number
     9	    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')      // earth
    10	    ;[s, b2] = withField(s, 0, 'backups', 'V-B2')      // lightning
    11	    ;[s] = withHand(s, 0, 'V-F8')                       // lightning 9000 — valuable, must not be discarded
    12	    ;[s, card] = withHand(s, 0, 'V-F2')                 // earth cost 2
    13	    const p = preferredPayment(s, 0, card)!
    14	    expect([...p.dullBackups].sort()).toEqual([b1, b2].sort()); expect(p.discards).toEqual([])
    15	    expect(canPay(2, ['earth'], generateCp(s, 0, p, card))).toBe(true)
    16	  })
    17	  it('discards the lowest-value cards when backups are insufficient, never the card itself', () => {
    18	    let s = withHandSize(makeGame(), 0, 0); let cheap: number, card: number
    19	    ;[s, cheap] = withHand(s, 0, 'V-S2')                 // earth summon cost 1 — low value
    20	    ;[s] = withHand(s, 0, 'V-F7')                        // earth 8000 — high value
    21	    ;[s, card] = withHand(s, 0, 'V-F2')                  // earth cost 2
    22	    const p = preferredPayment(s, 0, card)!
    23	    expect(p.discards.map((d) => d.card)).toEqual([cheap]); expect(p.dullBackups).toEqual([])
    24	  })
    25	  it('R1: picks the lowest-VALUE discard for a required element regardless of hand order', () => {
    26	    // The test above happens to hold the cheap card first, so an implementation that ranks equal-CP sources by
    27	    // hand position still passes it. Both discards supply earth and both generate 2 CP, so only card value can
    28	    // separate them: reversing the hand must not change which one is thrown away.
    29	    for (const order of [['V-S2', 'V-F7'], ['V-F7', 'V-S2']]) {
    30	      let s = withHandSize(makeGame(), 0, 0); let card: number
    31	      for (const code of order) [s] = withHand(s, 0, code)   // V-S2 = earth summon cost 1 (low value), V-F7 = earth 8000 (high)
    32	      ;[s, card] = withHand(s, 0, 'V-F2')                     // earth cost 2
    33	      const p = preferredPayment(s, 0, card)!
    34	      expect(p.discards.map((d) => defOf(s, d.card).code)).toEqual(['V-S2'])
    35	    }
    36	  })
    37	  it('R5: is MINIMAL — never spends a source the payment does not need (Codex counterexample)', () => {
    38	    // Earth cost-2 with one active Earth backup (1 CP) and one cheap Earth discard (2 CP). The required-element
    39	    // phase took the backup (cheapest source for earth), then the top-up phase added the discard to reach 2 CP —
    40	    // spending BOTH for a total of 3 CP, when the discard alone pays exactly. Worse, `enumeratePayments` only
    41	    // emits MINIMAL payments, so this non-minimal result is not in `legalCommands` at all: measured over real
    42	    // games, 40.2% of preferredPayment results were unusable as commands for that reason.
    43	    let s = withHandSize(makeGame(), 0, 0); let card: number
    44	    ;[s] = withField(s, 0, 'backups', 'V-B1')   // earth backup, 1 CP
    45	    ;[s] = withHand(s, 0, 'V-S2')                // earth summon cost 1 — cheap discard, 2 CP
    46	    ;[s, card] = withHand(s, 0, 'V-F2')          // earth cost 2
    47	    const p = preferredPayment(s, 0, card)!
    48	    expect(generateCp(s, 0, p, card)).toHaveLength(2)   // exactly the cost, not 3
    49	    expect(p.dullBackups).toEqual([])                    // the backup stays active
    50	    expect(p.discards).toHaveLength(1)
    51	  })
    52	  it('R5: every preferredPayment result is among the minimal payments legalCommands offers', () => {
    53	    // The property that makes preferredPayment usable as a UI/AI move generator at all: whatever it returns must
    54	    // be a command the engine would list. Checked across fixtures that exercise backups-only, discards-only,
    55	    // mixed, and multi-element costs.
    56	    const fixtures: (() => [ReturnType<typeof makeGame>, number])[] = [
    57	      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
    58	        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withField(s, 0, 'backups', 'V-B3'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
    59	      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
    60	        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withHand(s, 0, 'V-S2'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
    61	      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
    62	        ;[s] = withHand(s, 0, 'V-S2'); ;[s] = withHand(s, 0, 'V-F6'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
    63	      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
    64	        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withHand(s, 0, 'V-F6'); ;[s, c] = withHand(s, 0, 'V-F4'); return [s, c] },
    65	    ]
    66	    for (const [i, make] of fixtures.entries()) {
    67	      const [s, card] = make()
    68	      const p = preferredPayment(s, 0, card)
    69	      if (!p) continue
    70	      const legal = legalCommands(s, 0).filter((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card)
    71	      const match = legal.some((c) => JSON.stringify((c as { payment: unknown }).payment) === JSON.stringify(p))
    72	      expect(match, `fixture ${i}: ${JSON.stringify(p)} not among ${legal.length} legal payments`).toBe(true)
    73	    }
    74	  })
    75	  it('satisfies multi-element requirements and returns null when unaffordable', () => {
    76	    let s = withHandSize(makeGame(), 0, 0); let dual: number, poor: number
    77	    ;[s] = withField(s, 0, 'backups', 'V-B1')          // earth
    78	    ;[s] = withHand(s, 0, 'V-F6')                       // lightning 2000 — cheap discard supplies lightning
    79	    ;[s, dual] = withHand(s, 0, 'V-F4')                 // earth/lightning cost 2
    80	    const p = preferredPayment(s, 0, dual)!
    81	    expect(canPay(2, ['earth', 'lightning'], generateCp(s, 0, p, dual))).toBe(true)
    82	    let t = withHandSize(makeGame(), 0, 0)
    83	    ;[t, poor] = withHand(t, 0, 'V-F8')                 // cost 5, nothing to pay with
    84	    expect(preferredPayment(t, 0, poor)).toBeNull()
    85	  })
    86	  it('F4: satisfies scarce elements first so a dual-element discard is kept for the element only it can pay (Codex counterexample)', () => {
    87	    const defs = [
    88	      ...VANILLA_POOL,
    89	      makeDef({ code: 'V-TARGET', type: 'forward', elements: ['earth', 'lightning'], cost: 3, power: 5000 }),   // the cast target
    90	      makeDef({ code: 'V-DUAL', type: 'forward', elements: ['earth', 'lightning'], cost: 1, power: 1000 }),      // cheap — only source of lightning
    91	      makeDef({ code: 'V-EARTHONLY', type: 'forward', elements: ['earth'], cost: 5, power: 9000 }),              // expensive — but still needed for earth
    92	    ]
    93	    let s = withHandSize(makeGame({ defs }), 0, 0); let target: number
    94	    ;[s] = withHand(s, 0, 'V-EARTHONLY')
    95	    ;[s] = withHand(s, 0, 'V-DUAL')
    96	    ;[s, target] = withHand(s, 0, 'V-TARGET')
    97	    // A greedy cheapest-first-by-element algorithm spends V-DUAL on earth (it's cheaper than V-EARTHONLY) and then
    98	    // has nothing left for lightning. The correct payment spends V-EARTHONLY on earth and V-DUAL on lightning.
    99	    const p = preferredPayment(s, 0, target)!
   100	    expect(p).not.toBeNull()
   101	    expect(canPay(3, ['earth', 'lightning'], generateCp(s, 0, p, target))).toBe(true)
   102	  })
   103	  it('does not count a multi-element backup for its non-first element (engine produces elements[0] only)', () => {
   104	    const defs = [...VANILLA_POOL, makeDef({ code: 'V-BD', type: 'backup', elements: ['earth', 'lightning'], cost: 1, power: null })]
   105	    let s = withHandSize(makeGame({ defs }), 0, 0); let card: number
   106	    ;[s] = withField(s, 0, 'backups', 'V-BD')          // produces EARTH only
   107	    ;[s, card] = withHand(s, 0, 'V-F6')                 // lightning cost 1 — cannot be paid
   108	    expect(preferredPayment(s, 0, card)).toBeNull()
   109	  })
   110	  it('C2: bounded backtracking covers 3 required elements when a single scarcity-ordered greedy pass would strand one (Codex counterexample)', () => {
   111	    const defs = [
   112	      ...VANILLA_POOL,
   113	      makeDef({ code: 'V-TARGET3', type: 'forward', elements: ['earth', 'lightning', 'fire'], cost: 3, power: 5000 }),
   114	      makeDef({ code: 'V-EARTH', type: 'forward', elements: ['earth'], cost: 4, power: 8000 }),          // sole earth-only source — EXPENSIVE
   115	      makeDef({ code: 'V-EL', type: 'forward', elements: ['earth', 'lightning'], cost: 1, power: 1000 }), // sole other earth source, one of two lightning sources — CHEAP
   116	      makeDef({ code: 'V-LF', type: 'forward', elements: ['lightning', 'fire'], cost: 2, power: 3000 }),  // sole fire source, other lightning source
   117	    ]
   118	    let s = withHandSize(makeGame({ defs }), 0, 0); let target: number
   119	    ;[s] = withHand(s, 0, 'V-EARTH')
   120	    ;[s] = withHand(s, 0, 'V-EL')
   121	    ;[s] = withHand(s, 0, 'V-LF')
   122	    ;[s, target] = withHand(s, 0, 'V-TARGET3')
   123	    // Scarcity puts fire first (only V-LF), then earth (tie, processed next): a single greedy pass picks the
   124	    // CHEAPEST earth source, V-EL — but V-EL is the ONLY remaining source for lightning once V-LF is spent on
   125	    // fire, so a non-backtracking greedy pass then fails lightning even though {earth: V-EARTH, lightning: V-EL,
   126	    // fire: V-LF} is a legal assignment. Bounded backtracking must find it.
   127	    const p = preferredPayment(s, 0, target)
   128	    expect(p).not.toBeNull()
   129	    expect(canPay(3, ['earth', 'lightning', 'fire'], generateCp(s, 0, p!, target))).toBe(true)
   130	  })
   131	  it('C3: preferredPayment pays a Light card with two off-element (earth) backups, no same-element CP needed', () => {
   132	    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
   133	    let s = withHandSize(makeGame({ defs }), 0, 0); let card: number
   134	    ;[s] = withField(s, 0, 'backups', 'V-B1')   // earth
   135	    ;[s] = withField(s, 0, 'backups', 'V-B3')   // earth
   136	    ;[s, card] = withHand(s, 0, 'V-L1')
   137	    const p = preferredPayment(s, 0, card)
   138	    expect(p).not.toBeNull()
   139	    expect(p!.discards).toEqual([])
   140	    expect(canPay(2, [], generateCp(s, 0, p!, card))).toBe(true)
   141	  })
   142	})
nl: packages/engine/test/cp.test.ts: No such file or directory

exec
/bin/zsh -lc 'cat package.json && cat packages/engine/package.json && cat packages/ai/package.json && cat apps/web/package.json' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
{
  "name": "fftcg-game",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.20.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b packages/engine packages/cards packages/ai apps/cli apps/web",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "eslint": "^9.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
{
  "name": "@fftcg/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
{
  "name": "@fftcg/ai",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@fftcg/engine": "workspace:*" }
}
{
  "name": "@fftcg/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "fetch-images": "tsx scripts/fetch-images.ts"
  },
  "dependencies": {
    "@fftcg/ai": "workspace:*",
    "@fftcg/cards": "workspace:*",
    "@fftcg/engine": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "vite": "^7.0.0"
  }
}

exec
/bin/zsh -lc "rg -n \"ZoneTransitionReason|reason ===|reason: 'cost'|reason: 'ability'|reason: 'zeroPower'|reason: 'damage'|zoneChange\" packages apps | head -300 && rg -n \"trigger\\.kind|AbilityTrigger|abilityTriggered\" packages apps -g '*.ts' | head -360" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
packages/engine/src/events.ts:34:  | { type: 'putIntoBreakZone'; card: CardId; reason: 'zeroPower' }     // §12.4.4
packages/engine/src/rules.ts:4:import type { ZoneTransitionReason } from './abilities.js'
packages/engine/src/rules.ts:58:  readonly reason: ZoneTransitionReason
packages/engine/src/rules.ts:76:      if (power <= 0) out.push({ ...base, reason: 'zeroPower' })
packages/engine/src/rules.ts:77:      else if (power >= 1000 && c.damage >= power && !c.flags.includes('cannotBeBroken')) out.push({ ...base, reason: 'damage' })
packages/engine/src/rules.ts:114:      if (t.reason === 'zeroPower') events.push({ type: 'putIntoBreakZone', card: t.card, reason: 'zeroPower' })
packages/engine/src/rules.ts:117:      if (t.reason === 'damage') events.push({ type: 'broken', card: t.card })
packages/engine/src/abilities.ts:131:export type ZoneTransitionReason = 'zeroPower' | 'damage' | 'ability' | 'cost'
packages/engine/src/abilities.ts:172:  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly from: 'field'; readonly to: 'breakZone'; readonly controller: PlayerId; readonly owner: PlayerId; readonly reason: ZoneTransitionReason }
packages/engine/src/activate.ts:144:        from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'cost',
packages/engine/src/resolve.ts:323:          from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'ability',
packages/engine/src/resolve.ts:585:    const event: TriggerEvent = { kind: 'zoneChange', card: t.card, from: 'field', to: 'breakZone', controller: t.controller, owner: t.owner, reason: t.reason }
apps/web/src/game/useGame.ts:4:  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView, type ZoneTransitionReason,
apps/web/src/game/useGame.ts:59:    case 'discarded': return e.reason === 'cp' ? null : { kind: 'event', text: `${who(v, e.player)} discard${e.player === v.me ? '' : 's'} ${name(v, e.card)} to the hand limit` }
apps/web/src/game/useGame.ts:125:interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; readonly reason: ZoneTransitionReason; used: boolean }
apps/web/src/game/useGame.ts:162:    return { kind: 'zoneChange', card: hit.card, controller: hit.controller, reason: hit.reason }
apps/web/src/game/useGame.ts:197:      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), reason: 'ability', used: false }); break
apps/web/src/game/useGame.ts:200:      case 'paidToBreakZone': zoneHits.push({ card: e.card, controller: e.player, reason: 'cost', used: false }); break
apps/web/src/game/commands.ts:5:  type ZoneTransitionReason,
apps/web/src/game/commands.ts:54:  | { readonly kind: 'zoneChange'; readonly card: CardId; readonly controller: PlayerId; readonly reason?: ZoneTransitionReason }
apps/web/src/game/commands.ts:69:  if (ev.kind === 'zoneChange') {
apps/web/src/game/commands.ts:70:    const how = ev.reason === 'cost' ? 'was put into the Break Zone' : 'was broken'
apps/web/test/useGame.test.ts:152:    expect(describeEvent(view, { type: 'gameOver', result: { winner: HUMAN, reason: 'damage' } })?.text).toContain('you win')
apps/web/test/useGame.test.ts:153:    expect(describeEvent(view, { type: 'gameOver', result: { winner: AI, reason: 'damage' } })?.text).toContain('the AI wins')
apps/web/test/useGame.test.ts:527:      triggerEvent: { kind: 'zoneChange', card: ids.sphene, from: 'field', to: 'breakZone', controller: AI, owner: AI , reason: 'ability'},
apps/web/test/commands.test.ts:422:    const broken: TriggerEvent = { kind: 'zoneChange', card: THEIRS, from: 'field', to: 'breakZone', controller: AI, owner: AI , reason: 'ability'}
apps/web/test/commands.test.ts:427:    const mineBroken: TriggerEvent = { kind: 'zoneChange', card: MINE, from: 'field', to: 'breakZone', controller: HUMAN, owner: HUMAN , reason: 'ability'}
packages/ai/test/ismcts-keys.test.ts:427:      queue: [{ abilityId: 'Y-SRC:etb', source: a1, controller: 1, path: [], chosen: [], modes: [], triggerEvent: { kind: 'zoneChange', card: z1, from: 'field', to: 'breakZone', controller: 1, owner: 1 , reason: 'ability'} }],
packages/ai/test/ismcts-keys.test.ts:464:      ['queued frame.triggerEvent.card', { ...view, resolution: { ...view.resolution, queue: [{ ...view.resolution.queue[0]!, triggerEvent: { kind: 'zoneChange', card: ids.d1!, from: 'field', to: 'breakZone', controller: 1, owner: 1 , reason: 'ability'} }] } }],
packages/ai/src/ismcts/keys.ts:439:    case 'zoneChange':
packages/engine/test/cr12-rules.test.ts:11:    expect(events).toEqual([{ type: 'putIntoBreakZone', card: z, reason: 'zeroPower' }])
packages/engine/test/abilities-engine.test.ts:325:    expect(events).toContainEqual({ type: 'putIntoBreakZone', card: weak, reason: 'zeroPower' })
packages/engine/test/observer-triggers.test.ts:185:      { kind: 'zoneChange', card: a, from: 'field', to: 'breakZone', controller: 1, owner: 1, reason: 'damage' },
packages/engine/test/observer-triggers.test.ts:186:      { kind: 'zoneChange', card: b, from: 'field', to: 'breakZone', controller: 1, owner: 1, reason: 'damage' },
packages/engine/src/legal.ts:96:      if (ability.trigger.kind !== 'activated') continue
apps/cli/src/render.ts:66:  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'ability'
packages/engine/src/cast.ts:2:import type { AbilityTrigger } from './abilities.js'
packages/engine/src/cast.ts:55:function dispatch(state: GameState, def: CardDef, card: CardId, controller: PlayerId, trigger: AbilityTrigger): GameState {
packages/engine/src/cast.ts:57:  for (const ability of def.abilities ?? []) if (ability.trigger.kind === trigger.kind) s = enqueueTrigger(s, card, controller, ability)
packages/engine/src/cast.ts:92:  const resolves = (def.abilities ?? []).some((a) => a.trigger.kind === 'summonResolve')
packages/engine/src/resolve.ts:1:import type { Ability, AbilityTrigger, Effect, Frame, TargetFilter, TargetSpec, TriggerEvent, TriggerWhose } from './abilities.js'
packages/engine/src/resolve.ts:71:      if (a.trigger.kind !== 'dealtDamage' || a.trigger.to !== to) continue
packages/engine/src/resolve.ts:428:      events.push({ type: 'abilityTriggered', player: frame.controller, card: frame.source, abilityId: frame.abilityId })
packages/engine/src/resolve.ts:527:function watches(state: GameState, trigger: AbilityTrigger, watcher: PlayerId, t: ZoneTransition): boolean {
packages/engine/src/resolve.ts:528:  if (trigger.kind !== 'observesZoneChange') return false
packages/engine/src/events.ts:36:  | { type: 'abilityTriggered'; player: PlayerId; card: CardId; abilityId: string }
packages/engine/src/abilities.ts:101:export type AbilityTrigger =
packages/engine/src/abilities.ts:181:  readonly trigger: AbilityTrigger
apps/web/src/game/useGame.ts:4:  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView, type ZoneTransitionReason,
apps/web/src/game/useGame.ts:49: * `cause` is what fired an `abilityTriggered` (spec C2-5) — `eventLines` supplies it; it is ignored everywhere
apps/web/src/game/useGame.ts:77:    case 'abilityTriggered': {
apps/web/src/game/useGame.ts:106:/** The clause an `abilityTriggered` names, from the AST on `CardDef` — its `trigger` says what fired it. */
apps/web/src/game/useGame.ts:107:function triggerOf(v: PlayerView, card: CardId, abilityId: string): AbilityTrigger | null {
apps/web/src/game/useGame.ts:128: * Pair one `abilityTriggered` with the event that fired it, consuming the candidate so the NEXT trigger of the
apps/web/src/game/useGame.ts:139:  v: PlayerView, e: Extract<Event, { type: 'abilityTriggered' }>,
apps/web/src/game/useGame.ts:144:  if (trigger.kind === 'dealtDamage') {
apps/web/src/game/useGame.ts:156:  if (trigger.kind === 'observesZoneChange') {
apps/web/src/game/useGame.ts:172: * emits `abilityTriggered` — so the n-th trigger of the batch is `queued[n]`. That is what rescues a trigger
apps/web/src/game/useGame.ts:204:    if (e.type === 'abilityTriggered') {
packages/engine/src/activate.ts:41:  if (!ability || ability.trigger.kind !== 'activated') return null
packages/engine/src/activate.ts:75:  if (!ability || ability.trigger.kind !== 'activated') return `${abilityId} is not an activated ability of ${source}`
packages/engine/src/activate.ts:176:  if (!ability || ability.trigger.kind !== 'activated') throw new IllegalCommandError('unreachable: checked above')
apps/web/src/game/commands.ts:467:  if (!ability || ability.trigger.kind !== 'activated') return null
apps/web/src/game/commands.ts:480:  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'Ability'
packages/engine/test/party-damage.test.ts:90:  events.filter((e) => e.type === 'abilityTriggered' && e.abilityId === abilityId)
packages/engine/test/party-damage.test.ts:140:        .toEqual([{ type: 'abilityTriggered', player: 0, card: luso, abilityId: BURN_AND_RETRIEVE }])
packages/engine/test/party-damage.test.ts:288:    expect(events.filter((e) => e.type === 'abilityTriggered').map((e) => e.abilityId))
packages/engine/test/party-damage.test.ts:291:      .toBeLessThan(at(events, (e) => e.type === 'abilityTriggered' && e.abilityId === BURN_AND_RETRIEVE))
packages/engine/test/party-damage.test.ts:293:      .toBeLessThan(at(events, (e) => e.type === 'abilityTriggered' && e.abilityId === BREAK_IT))
packages/engine/test/party-damage.test.ts:309:    expect(r.events.some((e) => e.type === 'abilityTriggered' && e.abilityId !== BURN_AND_RETRIEVE)).toBe(false)
apps/web/test/useGame.test.ts:302:    const line = describeEvent(view, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: THREE_MODES.id })
apps/web/test/useGame.test.ts:341:    expect(describeEvent(v, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: multi.id })?.text).toContain('Line one. Line two.')
apps/web/test/useGame.test.ts:479:const triggered = (player: PlayerId, card: CardId, abilityId: string): Event => ({ type: 'abilityTriggered', player, card, abilityId })
packages/engine/test/observer-triggers.test.ts:81:  events.filter((e) => e.type === 'abilityTriggered' && e.abilityId === abilityId)
packages/engine/test/observer-triggers.test.ts:127:    expect(ids(r.events, HASTE)).toEqual([{ type: 'abilityTriggered', player: 0, card: lightning, abilityId: HASTE }])
packages/engine/test/observer-triggers.test.ts:129:    expect(at(r.events, (e) => e.type === 'abilityTriggered' && e.abilityId === HASTE))
packages/engine/test/observer-triggers.test.ts:205:    expect(ids(r.events, HASTE)).toEqual([{ type: 'abilityTriggered', player: 1, card: theirs, abilityId: HASTE }])
packages/engine/test/observer-triggers.test.ts:281:      .toBeLessThan(at(r.events, (e) => e.type === 'abilityTriggered' && e.abilityId === BREAK_IT))
packages/engine/test/observer-triggers.test.ts:290:    expect(at(r.events, (e) => e.type === 'abilityTriggered' && e.abilityId === BREAK_IT))
packages/engine/test/observer-triggers.test.ts:346:      .toBeLessThan(at(last.events, (e) => e.type === 'abilityTriggered' && e.abilityId === 'T-TWO:b'))
packages/ai/src/candidates.ts:100:    if (a.trigger.kind !== 'dealtDamage' || a.trigger.to !== 'forward') continue
packages/ai/src/candidates.ts:327:      if (ability.trigger.kind !== 'activated') continue
packages/ai/test/greedy.test.ts:398:          triggered += r.events.filter((e) => e.type === 'abilityTriggered').length
packages/ai/test/greedy.test.ts:543:        observed += r.events.filter((e) => e.type === 'abilityTriggered' && e.abilityId.endsWith(':broken')).length
packages/cards/src/abilities.ts:313: * The first abilities in this pool a PLAYER chooses to use rather than merely receives. `trigger.kind` is
packages/cards/test/abilities.test.ts:287:    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: ramuh, abilityId: '20-103H:summon' })
packages/cards/test/abilities.test.ts:360:    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: prishe, abilityId: '22-068R:damages-opponent' })
packages/cards/test/abilities.test.ts:410:    expect(r.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: luso, abilityId: '27-125S:damages-opponent' })
packages/cards/test/abilities.test.ts:433:    expect(t.events).toContainEqual({ type: 'abilityTriggered', player: 0, card: luso, abilityId: '27-125S:damages-forward' })

exec
/bin/zsh -lc "nl -ba packages/ai/src/greedy.ts | sed -n '1,270p'; nl -ba packages/ai/test/ismcts-keys.test.ts | sed -n '245,315p'; nl -ba packages/ai/test/ismcts-keys.test.ts | sed -n '400,485p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { SYNTHETIC_ID_BASE, actingPlayer, apply, determinise, hasResolutionWork, legalCommands, seedRng, type CardId, type Command, type GameState, type PlayerId, type PlayerView, type Rng } from '@fftcg/engine'
     2	import type { Agent } from './agent.js'
     3	import { candidateCommands } from './candidates.js'
     4	import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate.js'
     5	
     6	export interface GreedyOptions {
     7	  seed: number
     8	  decks: [string[], string[]]
     9	  depth?: 0 | 1 | 2 | undefined
    10	  weights?: Weights | undefined
    11	  aggression?: number | undefined
    12	  /**
    13	   * Soft cap on the number of `apply()` calls spent on the *rollout* portion of scoring one candidate. Each
    14	   * candidate gets its own fresh budget, `perCandidate = max(1, floor(maxSimulations / candidates))`, so scoring
    15	   * is invariant under candidate reordering (C1) — a shared budget would let early candidates starve later ones.
    16	   * The top-level apply and the forced-decision resolution that follows it (`resolveForcedDecisions` — combat and
    17	   * ability resolution alike) are exempt from the cap — they always run to completion (W1) — but their applies
    18	   * still count against the budget, so the rollout loop that follows may already be over cap before it starts.
    19	   * `lastSimulations` sums `used` across all per-candidate budgets.
    20	   *
    21	   * R3: this is a SOFT cap with no closed-form bound on `lastSimulations`. Budget-exempt combat resolution and
    22	   * `greedyStep`'s always-score-the-first-candidate floor both overrun it by an amount that depends on the
    23	   * position — a declareAttack at `maxSimulations: 50` was measured at 107 applies, so the bound this comment
    24	   * previously claimed (`<= maxSimulations + lastCandidates`) is false. What the cap does guarantee is EQUAL
    25	   * allocation across candidates (hence order-invariant scoring, C1) and proportionally more search as it rises.
    26	   * A tight bound would need the rollout and combat portions counted separately; not worth it while the A8
    27	   * budget (< 50 ms/decision) is met with ~200x headroom.
    28	   */
    29	  maxSimulations?: number | undefined
    30	}
    31	
    32	interface Budget { used: number; cap: number }
    33	const within = (b: Budget | undefined): boolean => !b || b.used < b.cap
    34	
    35	/**
    36	 * The decisions that are part of finishing something already started, rather than a move of one's own: the two
    37	 * combat steps, and (rung C1) the choices a resolving ability suspends on. `evaluate` may never see a state
    38	 * owing one of these — a half-resolved attack prices an attack that dealt no damage (R4), and a half-resolved
    39	 * ability prices an ability that did nothing (the same defect class, arriving by the new route).
    40	 *
    41	 * C2-6 opens a THIRD route to the same defect and it is the reason for the second clause. `drainResolution` now
    42	 * completes ONE frame and yields, so `settle` interleaves §12.3 rule processes between frames — and a rule
    43	 * process can enqueue an observer trigger (spec C2-4) BEHIND a decision that is already on the table. Settlement
    44	 * then stops on a pending that is not one of the four, with frames still queued, and `evaluate` would price a
    45	 * board whose queued clause has not done its work. So: the four kinds are forced unconditionally, and every
    46	 * OTHER kind is forced exactly while the agenda still owes something. Setup choices (`mulligan`, `chooseFirst`)
    47	 * are unaffected — nothing is ever queued during setup — so they stay the agent's own move to score.
    48	 */
    49	const isForcedDecision = (state: GameState): boolean => {
    50	  const kind = state.pending?.kind
    51	  if (kind === undefined) return false
    52	  if (kind === 'declareBlock' || kind === 'assignPartyDamage' || kind === 'chooseTargets' || kind === 'chooseMode') return true
    53	  return hasResolutionWork(state.resolution)
    54	}
    55	
    56	/**
    57	 * Fast-forward through every forced decision: while one is pending, the acting player `p` answers with
    58	 * `greedyStep`, scored from `p === perspective ? aggression : 1 - aggression` (C4 — keyed on the explicit
    59	 * `perspective` player, not `state.turnPlayer`, so the agent's own defensive decisions are scored from its own
    60	 * viewpoint even though the attacker holds `turnPlayer`/priority throughout the Attack Phase). Never exits early
    61	 * because the budget is exhausted (W1) — every apply here still counts against it, but a combat and an ability
    62	 * always run to completion.
    63	 *
    64	 * Terminates: the combat kinds strictly advance the attack (a block decision, then optionally a party-damage
    65	 * split, then neither), and an ability choice strictly advances its frame's program counter — `resolution.steps`
    66	 * persists across choices precisely so a clause that never finishes hits `MAX_RESOLUTION_STEPS` and throws
    67	 * (spec C1-5) rather than spinning here. The C2-6 clause of `isForcedDecision` adds no new way to spin: it only
    68	 * ever fires while the agenda is non-empty, and answering the pending lets `settle` drain a frame, so each pass
    69	 * either shrinks the agenda or hits the step cap.
    70	 */
    71	export function resolveForcedDecisions(state: GameState, weights: Weights, aggression: number, perspective: PlayerId, budget?: Budget): GameState {
    72	  let s = state
    73	  while (!s.result && isForcedDecision(s)) {
    74	    const p = actingPlayer(s)
    75	    if (p === null) break
    76	    const localAggression = p === perspective ? aggression : 1 - aggression
    77	    const c = greedyStep(s, p, weights, localAggression, budget)
    78	    if (!c) break
    79	    s = apply(s, c).state
    80	    if (budget) budget.used++
    81	  }
    82	  return s
    83	}
    84	
    85	/**
    86	 * Score every legal command for `player` and return the best one (ties keep the earlier candidate). Always
    87	 * guarantees at least the first candidate is applied and scored, even with an exhausted budget (W1) — only
    88	 * subsequent candidates are gated by `within(budget)`. Every candidate is scored on `resolveForcedDecisions(apply(state,
    89	 * c).state, weights, aggression, player, budget)` — `player` doubles as the perspective, so a nested call here
    90	 * (e.g. scoring a `declareBlock` candidate from inside `resolveForcedDecisions`'s own loop) resolves that candidate's
    91	 * combat all the way through (a party's damage split included, W2) before it is evaluated, not on the mid-combat
    92	 * snapshot taken the instant it is applied. The recursion this creates is bounded: each pending kind strictly
    93	 * advances the attack, so a block decision recurses into at most one further (party-damage) decision.
    94	 */
    95	export function greedyStep(state: GameState, player: PlayerId, weights: Weights, aggression: number, budget?: Budget): Command | null {
    96	  let best: Command | null = null
    97	  let bestScore = -Infinity
    98	  let i = 0
    99	  for (const c of candidateCommands(state, player)) {
   100	    if (i > 0 && !within(budget)) break
   101	    i++
   102	    const after = apply(state, c).state
   103	    if (budget) budget.used++
   104	    const scored = resolveForcedDecisions(after, weights, aggression, player, budget)
   105	    const score = evaluate(scored, player, weights, aggression)
   106	    if (score > bestScore) { best = c; bestScore = score }
   107	  }
   108	  return best
   109	}
   110	
   111	/** Deterministically keep only the first `max` candidates, but always keep `pass` (moved to the end) if it was present. */
   112	export function pruneCandidates(cands: Command[], max: number): Command[] {
   113	  if (cands.length <= max) return cands
   114	  const passIdx = cands.findIndex((c) => c.type === 'pass')
   115	  if (passIdx === -1 || passIdx < max) return cands.slice(0, max)
   116	  return [...cands.slice(0, max - 1), cands[passIdx] as Command]
   117	}
   118	
   119	export interface CandidateScoreOptions {
   120	  me: PlayerId
   121	  weights: Weights
   122	  aggression: number
   123	  depth: 0 | 1 | 2
   124	  owner: PlayerId
   125	  maxSimulations: number
   126	}
   127	
   128	export interface CandidateScore {
   129	  command: Command; score: number; turn: number; used: number
   130	  /** R4 diagnostic: the pending kind of the state that was actually scored. It must never be a FORCED decision
   131	   *  (`isForcedDecision`) — that would mean `evaluate` priced a mid-combat snapshot or a half-resolved ability,
   132	   *  which inverts the value of an attack. It is routinely non-null otherwise: `mulligan`, `chooseFirst` and
   133	   *  `discardToHandSize` show up on scored states in normal play (measured across 66,350 decisions) and are
   134	   *  priced correctly. Exposed so the real invariant is directly assertable rather than inferred from a score. */
   135	  pendingKind: string | null
   136	  /** The C1 half of the same diagnostic: work still on the resolution agenda (active + queued + continuation).
   137	   *  MUST be 0 — a scored state with an unfinished ability prices a clause that has not done its work yet.
   138	   *  C2-6 couples the two fields: the benign non-null `pendingKind`s above are benign ONLY at a zero agenda, and
   139	   *  `isForcedDecision`'s second clause is what keeps that true now that rule processes run between frames. */
   140	  resolutionQueued: number
   141	}
   142	
   143	/** Work the agenda still owes: the active frame, the queue, and a system continuation (which only
   144	 *  `drainResolution` consumes, so a state carrying nothing but one is NOT settled). Zero on a settled state. */
   145	const agendaSize = (s: GameState): number =>
   146	  (s.resolution.active ? 1 : 0) + s.resolution.queue.length + (s.resolution.continuation ? 1 : 0)
   147	
   148	/**
   149	 * Score every top-level candidate independently (C1): each gets its own fresh `Budget` sized
   150	 * `max(1, floor(maxSimulations / cands.length))`, so the result — and therefore the argmax `decide` picks — is
   151	 * invariant under the order `cands` is given in (a shared budget is not: early candidates would consume rollout
   152	 * work that later ones then lack). For each candidate: apply it and fully resolve every forced decision it opens
   153	 * — combat and ability resolution alike (both exempt from the budget cap, W1); then, per `depth`, roll out greedily to the end of the acting turn owner's
   154	 * turn (depth >= 1) and/or the following turn (depth >= 2), bounded by the budget. `turn` records the scored
   155	 * state's turn number (for asserting where a rollout stopped); `used` is that candidate's own budget spend.
   156	 */
   157	export function scoreCandidates(det: GameState, cands: Command[], opts: CandidateScoreOptions): CandidateScore[] {
   158	  const perCandidate = Math.max(1, Math.floor(opts.maxSimulations / cands.length))
   159	  return cands.map((cand) => {
   160	    const budget: Budget = { used: 0, cap: perCandidate }
   161	    let s = apply(det, cand).state
   162	    budget.used++   // floor: every candidate gets at least one apply regardless of budget
   163	    s = resolveForcedDecisions(s, opts.weights, opts.aggression, opts.me, budget)
   164	    const rollout = (until: (t: GameState) => boolean) => {
   165	      while (!s.result && until(s) && within(budget)) {
   166	        const p = actingPlayer(s)!
   167	        const c = greedyStep(s, p, opts.weights, p === opts.me ? opts.aggression : 1 - opts.aggression, budget)
   168	        if (!c) break
   169	        s = apply(s, c).state; budget.used++
   170	        // R4: resolve whatever this command opened BEFORE the loop can exit on an exhausted budget. Without
   171	        // this, a rollout that declares an attack and then runs out of budget leaves `pending: declareBlock`
   172	        // set, and `evaluate` prices a state where the attack was declared but no damage was dealt — which
   173	        // inverts an attack's value. C1 adds the same hazard by a second route: a cast that triggers an ETB
   174	        // clause leaves `pending: chooseMode`/`chooseTargets`, and the ability's effect is priced as nothing.
   175	        // Both are budget-exempt (W1) precisely so this always completes.
   176	        s = resolveForcedDecisions(s, opts.weights, opts.aggression, opts.me, budget)
   177	      }
   178	    }
   179	    if (opts.depth >= 1) rollout((t) => t.turnPlayer === opts.owner)   // finish the current turn (mine, or the opponent's when I am blocking)
   180	    if (opts.depth >= 2) rollout((t) => t.turnPlayer !== opts.owner)   // and the following turn
   181	    const score = evaluate(s, opts.me, opts.weights, opts.aggression)
   182	    return { command: cand, score, turn: s.turn, used: budget.used, pendingKind: s.pending?.kind ?? null, resolutionQueued: agendaSize(s) }
   183	  })
   184	}
   185	
   186	/** All `CardId`s a command references — used by `decide`'s W4 guard to reject a chosen command that leaked a synthetic id. */
   187	function commandCardIds(c: Command): CardId[] {
   188	  switch (c.type) {
   189	    case 'castCharacter': case 'castSummon': return [c.card, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
   190	    case 'declareAttack': return c.attackers
   191	    case 'declareBlock': return c.blocker === null ? [] : [c.blocker]
   192	    case 'assignPartyDamage': return c.assignments.map((a) => a.target)
   193	    case 'discardToHandSize': return c.cards
   194	    // C1: ability targets are card ids like any other. `chooseMode` answers are indices into the pending's
   195	    // printed labels, not ids, so it has none to check.
   196	    case 'chooseTargets': return [...c.targets]
   197	    // C3: the activation names its source AND every CP source it spends; all are ids that must be real.
   198	    case 'activateAbility': return [c.source, ...c.payment.dullBackups, ...c.payment.discards.map((d) => d.card)]
   199	    case 'chooseFirst': case 'mulligan': case 'chooseMode': case 'pass': case 'concede': return []
   200	    default: { const _exhaustive: never = c; return _exhaustive }
   201	  }
   202	}
   203	
   204	export class GreedyAgent implements Agent {
   205	  private rng: Rng
   206	  private readonly decks: [string[], string[]]
   207	  private readonly depth: 0 | 1 | 2
   208	  private readonly weights: Weights
   209	  private readonly aggression: number
   210	  private readonly maxSimulations: number
   211	  lastSimulations = 0
   212	  lastCandidates = 0
   213	  lastDepth: 0 | 1 | 2 = 0
   214	  /** Test/diagnostic hook: each top-level candidate's final score, resolved-state turn number, and budget spend from the most recent `decide`. */
   215	  lastScores: CandidateScore[] = []
   216	  readonly needsLegalCommands = false
   217	  constructor(opts: GreedyOptions) {
   218	    this.rng = seedRng(opts.seed); this.decks = opts.decks; this.depth = opts.depth ?? 1
   219	    this.weights = opts.weights ?? DEFAULT_WEIGHTS; this.aggression = opts.aggression ?? 0.5; this.maxSimulations = opts.maxSimulations ?? 2000
   220	  }
   221	  decide(view: PlayerView, legal: Command[]): Command {
   222	    this.lastSimulations = 0; this.lastCandidates = 0; this.lastDepth = 0; this.lastScores = []
   223	    const me = view.me
   224	    const [det, rng] = determinise({ view, decks: this.decks, rng: this.rng })
   225	    this.rng = rng
   226	    let cands = candidateCommands(det, me)   // pass is last by contract
   227	    if (!cands.length) {
   228	      // R2: conceding is only ever the right answer when we are NOT the acting player — then [concede] genuinely
   229	      // is the whole legal set (§2.1). When we ARE acting and candidate generation produced nothing, that is a gap
   230	      // in `candidateCommands` (which mirrors `legalCommands`'s switch rather than deriving from it), and
   231	      // `legalCommands` puts concede first — so falling back to `pool[0]` would silently throw the game rather
   232	      // than surface the bug. Fail loudly instead, per 5e82a7e's "fail loudly on a dead end, don't silently
   233	      // concede" policy; a genuine engine dead end is caught by self-play's strict invariant check.
   234	      if (actingPlayer(det) === me) {
   235	        throw new Error(`GreedyAgent.decide: no candidate commands while acting in ${det.phase}/${det.attack?.step ?? '-'}/${det.pending?.kind ?? '-'}`)
   236	      }
   237	      // legal may be [] here (needsLegalCommands is false, so a caller may skip generating it on the hot
   238	      // path); compute it ourselves rather than relying on the argument, but reuse a non-empty one as-is.
   239	      const pool = legal.length ? legal : legalCommands(det, me)
   240	      const fallback = pool[0]
   241	      if (!fallback) throw new Error('GreedyAgent.decide: no legal command to choose or fall back to')
   242	      return fallback
   243	    }
   244	    cands = pruneCandidates(cands, Math.max(1, this.maxSimulations))
   245	    this.lastCandidates = cands.length
   246	    const atDeclaration = det.phase === 'attack' && det.attack?.step === 'declaration'
   247	    // F5: setup (chooseFirst/mulligan) is scored at depth 0 — evaluate() already prices hand quality directly.
   248	    const depth: 0 | 1 | 2 = det.phase === 'setup' ? 0 : atDeclaration ? (Math.max(this.depth, 2) as 2) : this.depth   // spec A2
   249	    const owner = det.turnPlayer
   250	    const scores = scoreCandidates(det, cands, { me, weights: this.weights, aggression: this.aggression, depth, owner, maxSimulations: this.maxSimulations })
   251	    let best = scores[0]!.command
   252	    let bestScore = -Infinity
   253	    for (const sc of scores) { if (sc.score > bestScore) { best = sc.command; bestScore = sc.score } }
   254	    this.lastSimulations = scores.reduce((n, sc) => n + sc.used, 0)
   255	    this.lastScores = scores
   256	    this.lastDepth = depth
   257	    // W4: candidates are built from `me`'s own resources in the determinised state, which are always real
   258	    // (visible) ids — a chosen command should never reference a hidden card's synthetic id.
   259	    for (const id of commandCardIds(best)) if (id >= SYNTHETIC_ID_BASE) throw new Error(`GreedyAgent.decide: chosen command ${best.type} references synthetic id ${id}`)
   260	    return best
   261	  }
   262	}
   245	  it('zone refs sort by index numerically, not lexically (`f0:2` before `f0:10`)', () => {
   246	    let s = makeGame()
   247	    const ids: CardId[] = []
   248	    for (let i = 0; i < 12; i++) { let id: CardId; [s, id] = withField(s, 0, 'forwards', 'V-F1'); ids.push(id) }
   249	    const v = viewFor(s, 0)
   250	    const key = actionKey(v, { type: 'declareAttack', player: 0, attackers: [ids[10]!, ids[2]!] })
   251	    expect(key.endsWith('|f0:2,f0:10')).toBe(true)
   252	    expect(actionKey(v, { type: 'declareAttack', player: 0, attackers: [ids[2]!, ids[10]!] })).toBe(key)
   253	  })
   254	})
   255	
   256	describe('round trip (contract 5)', () => {
   257	  function roundTrip(det: GameState, p: PlayerId): number {
   258	    const dv = viewFor(det, p)
   259	    const cands = candidateCommands(det, p)
   260	    for (const c of cands) {
   261	      const key = actionKey(dv, c)
   262	      const back = decodeAction(dv, key)
   263	      expect(back, `decode failed for ${key}`).not.toBeNull()
   264	      // NOT raw-id equality: two copies of one code in hand share a ref, so decode legitimately returns the
   265	      // other copy. The contract is "an EQUIVALENT command that is legal in THIS world", and the two
   266	      // assertions below say exactly that — it keys back to where it came from, and the engine accepts it.
   267	      expect(actionKey(dv, back!)).toBe(key)
   268	      expect(() => apply(det, back!)).not.toThrow()   // legal in THIS world, which is the whole point
   269	    }
   270	    return cands.length
   271	  }
   272	
   273	  it('every candidate command round-trips, over many determinisations of a played-out game', () => {
   274	    let s = makeGame()
   275	    const decks = decksOf(s)
   276	    const agents: [GreedyAgent, GreedyAgent] = [new GreedyAgent({ seed: 7, decks }), new GreedyAgent({ seed: 11, decks })]
   277	    let seen = 0
   278	    const kinds = new Set<string>()
   279	    for (let step = 0; step < 60 && !s.result; step++) {
   280	      const p = actingPlayer(s)
   281	      if (p === null) break
   282	      const view = viewFor(s, p)
   283	      for (const seed of [1, 2, 3]) {
   284	        const [det] = determinise({ view, decks, rng: seedRng(seed) })
   285	        seen += roundTrip(det, p)
   286	        for (const c of candidateCommands(det, p)) kinds.add(c.type)
   287	      }
   288	      s = apply(s, agents[p].decide(view, [])).state
   289	    }
   290	    expect(seen).toBeGreaterThan(100)
   291	    // Guard against the loop degenerating into 60 passes and calling that coverage.
   292	    for (const t of ['pass', 'castCharacter', 'declareAttack', 'declareBlock']) expect(kinds).toContain(t)
   293	  })
   294	
   295	  it('setup decisions (chooseFirst, mulligan) round-trip too', () => {
   296	    const decks: [string[], string[]] = [DEFAULT_DECK, DEFAULT_DECK]
   297	    let s = createGame({ seed: 3, decks, defs: VANILLA_POOL })
   298	    for (let step = 0; step < 4 && s.pending; step++) {
   299	      const p = s.pending.player
   300	      const [det] = determinise({ view: viewFor(s, p), decks, rng: seedRng(step + 1) })
   301	      expect(roundTrip(det, p)).toBeGreaterThan(0)
   302	      s = apply(s, candidateCommands(det, p)[0]!).state
   303	    }
   304	    expect(s.phase).not.toBe('setup')
   305	  })
   306	
   307	  it('ability prompts (chooseTargets, chooseMode) round-trip', () => {
   308	    const targets = clause('T:etb', [{ kind: 'chooseTargets', min: 1, max: 2, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }])
   309	    const modes = clause('M:etb', [{ kind: 'chooseModes', min: 1, max: 2, modes: [
   310	      { label: 'Deal it 3000 damage', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'damage', amount: 3000 }] }] },
   311	      { label: 'Dull | it, and, tricky punctuation', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'opponent' }, then: [{ kind: 'dull' }] }] },
   312	    ] }])
   313	    for (const a of [targets, modes]) {
   314	      let s = makeGame({ defs: [...VANILLA_POOL, bearer('X-SRC', a)] })
   315	      let src: CardId
   400	      damageZone: f.damageZone.map(m),
   401	      breakZone: f.breakZone.map(m),
   402	    })) as PlayerView['fields'],
   403	    attack: view.attack === null ? null : { ...view.attack, attackers: view.attack.attackers.map(m), blocker: view.attack.blocker === null ? null : m(view.attack.blocker) },
   404	    pending: view.pending === null ? null : view.pending.kind === 'chooseTargets' ? { ...view.pending, candidates: view.pending.candidates.map(m) } : view.pending,
   405	    resolution: { ...res, active: res.active === null ? null : frame(res.active), queue: res.queue.map(frame) },
   406	  }
   407	}
   408	
   409	/** A view with an id in every site the digest has to hide: both fields, a damage zone, a break zone, an
   410	 *  attack with a blocker, a `chooseTargets` pending, and a resolution agenda with both trigger-event shapes. */
   411	function richView(): { view: PlayerView; ids: Record<string, CardId> } {
   412	  let s = makeGame()
   413	  let a1: CardId, a2: CardId, d1: CardId, b1: CardId, z1: CardId
   414	  ;[s, a1] = withField(s, 0, 'forwards', 'V-F2')
   415	  ;[s, a2] = withField(s, 0, 'forwards', 'V-F5')
   416	  ;[s, d1] = withField(s, 1, 'forwards', 'V-F7')
   417	  ;[s, b1] = withField(s, 0, 'backups', 'V-B1')
   418	  ;[s, z1] = withBreakZone(s, 1, 'V-F1')
   419	  s = hurt(s, 1, 2)
   420	  const base = viewFor(s, 0)
   421	  const view: PlayerView = {
   422	    ...base,
   423	    attack: { step: 'damage', attackers: [a1, a2], blocker: d1 },
   424	    pending: { kind: 'chooseTargets', player: 0, min: 1, max: 2, candidates: [d1, a1] },
   425	    resolution: {
   426	      active: { abilityId: 'X-SRC:etb', source: b1, controller: 0, path: [0, 1], chosen: [a1, d1], modes: [1], triggerEvent: { kind: 'damage', source: a2, sourceController: 0, target: d1, victim: null, amount: 3000 } },
   427	      queue: [{ abilityId: 'Y-SRC:etb', source: a1, controller: 1, path: [], chosen: [], modes: [], triggerEvent: { kind: 'zoneChange', card: z1, from: 'field', to: 'breakZone', controller: 1, owner: 1 , reason: 'ability'} }],
   428	      continuation: 'enterAttackDeclaration',
   429	      steps: 7,
   430	    },
   431	  }
   432	  return { view, ids: { a1, a2, d1, b1, z1 } }
   433	}
   434	
   435	describe('observationKey (contract 6)', () => {
   436	  it('hides every id — a wholesale renumbering produces the identical key', () => {
   437	    const { view, ids } = richView()
   438	    expect(Object.values(ids).length).toBeGreaterThan(0)
   439	    for (const shift of [1, 50_000, 900_000]) {
   440	      const shifted = remapIds(view, shift)
   441	      expect(JSON.stringify(shifted)).not.toBe(JSON.stringify(view))   // the fixture really did renumber
   442	      expect(observationKey(shifted)).toBe(observationKey(view))
   443	    }
   444	    // A substring hunt for raw ids is not the assertion to make here — small ids collide with damage amounts and
   445	    // step counts. Invariance under three different shifts is the sound form of "no id survives", and the
   446	    // sibling test below is what stops it being satisfied by dropping the sites altogether.
   447	  })
   448	
   449	  it('and every id site is genuinely READ — invariance is not achieved by ignoring them', () => {
   450	    const { view, ids } = richView()
   451	    const key = observationKey(view)
   452	    const active = view.resolution.active!
   453	    // Each variant swaps ONE id site for a DIFFERENT card that is also in the view, so the ref changes and the
   454	    // key must change with it. Together with the renumbering test above, this pins each site to a real `CardRef`:
   455	    // a site that were dropped from the digest would pass the invariance test and fail here.
   456	    const swaps: [string, PlayerView][] = [
   457	      ['attack.attackers', { ...view, attack: { ...view.attack!, attackers: [ids.d1!, ids.a2!] } }],
   458	      ['attack.blocker', { ...view, attack: { ...view.attack!, blocker: ids.a1! } }],
   459	      ['pending.candidates', { ...view, pending: { kind: 'chooseTargets', player: 0, min: 1, max: 2, candidates: [ids.a2!, ids.a1!] } }],
   460	      ['frame.source', { ...view, resolution: { ...view.resolution, active: { ...active, source: ids.a1! } } }],
   461	      ['frame.chosen', { ...view, resolution: { ...view.resolution, active: { ...active, chosen: [ids.a2!, ids.d1!] } } }],
   462	      ['frame.triggerEvent.source', { ...view, resolution: { ...view.resolution, active: { ...active, triggerEvent: { kind: 'damage', source: ids.b1!, sourceController: 0, target: ids.d1!, victim: null, amount: 3000 } } } }],
   463	      ['frame.triggerEvent.target', { ...view, resolution: { ...view.resolution, active: { ...active, triggerEvent: { kind: 'damage', source: ids.a2!, sourceController: 0, target: ids.a1!, victim: null, amount: 3000 } } } }],
   464	      ['queued frame.triggerEvent.card', { ...view, resolution: { ...view.resolution, queue: [{ ...view.resolution.queue[0]!, triggerEvent: { kind: 'zoneChange', card: ids.d1!, from: 'field', to: 'breakZone', controller: 1, owner: 1 , reason: 'ability'} }] } }],
   465	    ]
   466	    for (const [why, v] of swaps) expect(observationKey(v), why).not.toBe(key)
   467	  })
   468	
   469	  it('but not what the root can actually see', () => {
   470	    const { view, ids } = richView()
   471	    const key = observationKey(view)
   472	    const differs = (v: PlayerView, why: string): void => expect(observationKey(v), why).not.toBe(key)
   473	    const f0 = view.fields[0]
   474	    differs({ ...view, turn: view.turn + 1 }, 'turn')
   475	    differs({ ...view, phase: 'main2' }, 'phase')
   476	    differs({ ...view, priority: 1 }, 'priority')
   477	    differs({ ...view, fields: [{ ...f0, deckCount: f0.deckCount - 1 }, view.fields[1]] }, 'my deck count')
   478	    differs({ ...view, fields: [f0, { ...view.fields[1], handCount: 99 }] }, "opponent's hand size")
   479	    differs({ ...view, fields: [{ ...f0, forwards: f0.forwards.map((c, i) => (i === 0 ? { ...c, damage: 3000 } : c)) }, view.fields[1]] }, 'damage on a forward')
   480	    differs({ ...view, fields: [{ ...f0, forwards: [...f0.forwards].reverse() }, view.fields[1]] }, 'field order (it is what positional refs mean)')
   481	    differs({ ...view, attack: { ...view.attack!, blocker: null } }, 'the blocker')
   482	    differs({ ...view, attack: { ...view.attack!, step: 'block' } }, 'the attack step')
   483	    differs({ ...view, pending: { kind: 'chooseTargets', player: 0, min: 2, max: 2, candidates: [ids.d1!, ids.a1!] } }, 'the prompt bounds')
   484	    differs({ ...view, pending: { kind: 'chooseTargets', player: 1, min: 1, max: 2, candidates: [ids.d1!, ids.a1!] } }, 'who owes the prompt')
   485	    differs({ ...view, resolution: { ...view.resolution, steps: 8 } }, 'agenda budget spent')

exec
/bin/zsh -lc "nl -ba packages/engine/src/cp.ts | sed -n '85,170p'; git diff 6f86fde..HEAD -- packages/engine/src/activate.ts packages/engine/src/resolve.ts apps/web/src/game/useGame.ts packages/ai/src/evaluate.ts | sed -n '1,420p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
    85	/** Every *minimal* legal payment for `card` (no source can be removed and still pay). Used by legalCommands as the canonical choice list; `apply` accepts any payment that `canPay` — overpaying is legal (§11.2.2.3). */
    86	export function enumeratePayments(state: GameState, player: PlayerId, card: CardId): Payment[] {
    87	  return enumeratePaymentsFor(state, player, castRequirement(state, card))
    88	}
    89	
    90	/** As `enumeratePayments`, for any requirement — an ability cost as readily as a card's printed cost. */
    91	export function enumeratePaymentsFor(state: GameState, player: PlayerId, req: CpRequirement): Payment[] {
    92	  const card = req.excluded
    93	  if (req.amount === 0) return [{ dullBackups: [], discards: [] }]
    94	  const elements = req.requiredElements
    95	  const ps = state.players[player]
    96	  const backups = ps.backups.filter((b) => b.status === 'active' && !card.includes(b.id)).map((b) => b.id)
    97	  const discardOptions = ps.hand
    98	    .filter((id) => !card.includes(id))
    99	    .flatMap((id) => defOf(state, id).elements.filter((e) => e !== 'light' && e !== 'dark').map((element) => ({ card: id, element })))
   100	  // Each hand card may be discarded at most once, so choose ≤1 element option per card.
   101	  const byCard = new Map<CardId, Element[]>()
   102	  for (const o of discardOptions) byCard.set(o.card, [...(byCard.get(o.card) ?? []), o.element])
   103	  const handCards = [...byCard.keys()]
   104	
   105	  const results: Payment[] = []
   106	  const nBackupSubsets = 1 << backups.length
   107	  const choices = handCards.map((c) => byCard.get(c) as Element[])
   108	  // iterate over backup subsets × per-card choice (none | element_i)
   109	  const walk = (i: number, discards: Payment['discards'], backupMask: number) => {
   110	    if (i === handCards.length) {
   111	      const dullBackups = backups.filter((_, k) => backupMask & (1 << k))
   112	      const payment = { dullBackups, discards }
   113	      const cp = generateCp(state, player, payment, card)
   114	      if (!canPay(req.amount, elements, cp)) return
   115	      // minimality: removing any single source must break payment
   116	      for (let k = 0; k < dullBackups.length; k++) {
   117	        const less = { ...payment, dullBackups: dullBackups.filter((_, j) => j !== k) }
   118	        if (canPay(req.amount, elements, generateCp(state, player, less, card))) return
   119	      }
   120	      for (let k = 0; k < discards.length; k++) {
   121	        const less = { ...payment, discards: discards.filter((_, j) => j !== k) }
   122	        if (canPay(req.amount, elements, generateCp(state, player, less, card))) return
   123	      }
   124	      results.push(payment)
   125	      return
   126	    }
   127	    walk(i + 1, discards, backupMask)
   128	    for (const element of choices[i] as Element[]) walk(i + 1, [...discards, { card: handCards[i] as CardId, element }], backupMask)
   129	  }
   130	  for (let mask = 0; mask < nBackupSubsets; mask++) walk(0, [], mask)
   131	  return results
   132	}
   133	
   134	/** Execute a payment. INTERNAL — callers must have run generateCp + canPay first (cast.ts does). */
   135	export function pay(state: GameState, player: PlayerId, payment: Payment): [GameState, Event[]] {
   136	  const events: Event[] = []
   137	  const s = updatePlayer(state, player, (ps) => ({
   138	    ...ps,
   139	    backups: ps.backups.map((b) => (payment.dullBackups.includes(b.id) ? { ...b, status: 'dull' } : b)),
   140	    hand: ps.hand.filter((id) => !payment.discards.some((d) => d.card === id)),
   141	    breakZone: [...ps.breakZone, ...payment.discards.map((d) => d.card)],
   142	  }))
   143	  for (const d of payment.discards) events.push({ type: 'discarded', player, card: d.card, reason: 'cp' })
   144	  const cp = [...payment.dullBackups.map((id) => defOf(state, id).elements[0] as Element), ...payment.discards.flatMap((d) => [d.element, d.element])]
   145	  events.unshift({ type: 'cpGenerated', player, cp })
   146	  return [s, events]
   147	}
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-8atJef2U' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-D6Qq9oAg' (errno=Operation not permitted)
diff --git a/apps/web/src/game/useGame.ts b/apps/web/src/game/useGame.ts
index b2f5b55..ef6e96f 100644
--- a/apps/web/src/game/useGame.ts
+++ b/apps/web/src/game/useGame.ts
@@ -1,7 +1,7 @@
 import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
 import {
   actingPlayer, apply, createGame, legalCommands, viewFor,
-  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView,
+  type AbilityTrigger, type CardId, type Command, type Event, type FieldFlag, type Frame, type GameState, type Keyword, type PlayerId, type PlayerView, type ZoneTransitionReason,
 } from '@fftcg/engine'
 import type { Agent } from '@fftcg/ai'
 import { CARD_DEFS, DECKS } from '../deck.js'
@@ -79,6 +79,14 @@ export function describeEvent(v: PlayerView, e: Event, cause: TriggerCause | nul
       const why = cause ? ` — ${describeTriggerCause(v, cause)}` : ''
       return { kind: 'event', text: `${name(v, e.card)}'s ability triggers${why}${text ? `: "${text}"` : ''}` }
     }
+    // C3: ACTIVATED, not triggered. The distinction is the whole of what this rung added for the player —
+    // "triggers" would report a move they deliberately made as something that merely happened to them.
+    case 'abilityActivated': {
+      const text = abilityText(v, e.card, e.abilityId)
+      const whose = e.player === v.me ? 'Your' : "The AI's"
+      return { kind: 'event', text: `${whose} ${name(v, e.card)} activates${text ? `: "${text}"` : ''}` }
+    }
+    case 'paidToBreakZone': return { kind: 'event', text: `${name(v, e.card)} is put into the Break Zone to pay for it` }
     case 'abilityNoLegalTarget': return { kind: 'event', text: `${name(v, e.card)}'s ability finds no legal target — nothing happens` }
     case 'dulled': return { kind: 'event', text: `${name(v, e.card)} is dulled` }
     case 'abilityDamage': return { kind: 'event', text: `${name(v, e.source)} deals ${e.amount} damage to ${name(v, e.target)}` }
@@ -114,7 +122,7 @@ function holderOf(v: PlayerView, id: CardId): PlayerId {
 
 interface Hit { readonly source: CardId; readonly target: CardId; readonly amount: number; used: boolean }
 interface PlayerHit { readonly victim: PlayerId; used: boolean }
-interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; used: boolean }
+interface ZoneHit { readonly card: CardId; readonly controller: PlayerId; readonly reason: ZoneTransitionReason; used: boolean }
 
 /**
  * Pair one `abilityTriggered` with the event that fired it, consuming the candidate so the NEXT trigger of the
@@ -151,7 +159,7 @@ function causeOf(
     const hit = zoneHits.find((h) => !h.used && wants(h.controller))
     if (!hit) return null
     hit.used = true
-    return { kind: 'zoneChange', card: hit.card, controller: hit.controller }
+    return { kind: 'zoneChange', card: hit.card, controller: hit.controller, reason: hit.reason }
   }
   return null   // enterField/summonResolve are about the source itself — there is nothing to explain
 }
@@ -186,7 +194,10 @@ export function eventLines(v: PlayerView, events: readonly Event[], queued: read
       case 'playerDamaged': playerHits.push({ victim: e.player, used: false }); break
       case 'broken':
       case 'brokenByAbility':
-      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), used: false }); break
+      case 'putIntoBreakZone': zoneHits.push({ card: e.card, controller: holderOf(v, e.card), reason: 'ability', used: false }); break
+      // C3: paying a cost moves a card the same way a break does, so an observer of the MOVEMENT fires on it
+      // and the log needs the same cause available — tagged, so it is not narrated as a break.
+      case 'paidToBreakZone': zoneHits.push({ card: e.card, controller: e.player, reason: 'cost', used: false }); break
       default: break
     }
     let cause: TriggerCause | null = null
diff --git a/packages/ai/src/evaluate.ts b/packages/ai/src/evaluate.ts
index 9c72781..5522558 100644
--- a/packages/ai/src/evaluate.ts
+++ b/packages/ai/src/evaluate.ts
@@ -16,6 +16,18 @@ export interface Weights {
   haste: number
   brave: number
   protection: number
+  /**
+   * Rung C3. The rate at which `powerBonus` — power that EXPIRES at end of turn — counts toward material,
+   * against `forwardPower` for power the card actually has.
+   *
+   * Without this the two are identical, and the arithmetic worked out exactly wrong. Losing an active
+   * 2000-power Undead Princess costs `2×1.2 + 4 + 2×0.8 = 8.0`; giving another Forward +4000 gains
+   * `4×1.2 + 4×0.8 = 8.0`. A dead heat — and `greedyStep` keeps the EARLIER command on a tie, so it would
+   * sacrifice a permanent body for a bonus that vanishes at end of turn, whether or not anything came of it.
+   * The bonus still counts fully toward `threat`, because a temporary bonus really does swing combat THIS
+   * turn; what it must not do is masquerade as a permanent gain.
+   */
+  temporaryPower: number
 }
 
 export const DEFAULT_WEIGHTS: Weights = {
@@ -32,6 +44,7 @@ export const DEFAULT_WEIGHTS: Weights = {
   haste: 1.0,
   brave: 0.6,
   protection: 0.5,
+  temporaryPower: 0.4,
 }
 
 /**
@@ -88,8 +101,14 @@ function material(state: GameState, p: PlayerId, w: Weights): number {
   const ps = state.players[p]
   let v = (DAMAGE_TO_LOSE - ps.damageZone.length) * w.damage
   for (const c of ps.forwards) {
-    v += (powerOf(state, c) / 1000) * w.forwardPower * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
-    if (c.status === 'active') v += (powerOf(state, c) / 1000) * w.threat   // active-power tempo: this side's own attack-ready threat
+    // Split permanent from until-end-of-turn power: `powerOf` is printed + `powerBonus`, and the two are not
+    // worth the same. `threat` deliberately keeps using the full figure — a temporary bonus does swing combat
+    // this turn, which is exactly what `threat` measures.
+    const total = powerOf(state, c)
+    const permanent = Math.max(0, total - c.powerBonus)
+    const temporary = total - permanent
+    v += ((permanent / 1000) * w.forwardPower + (temporary / 1000) * w.temporaryPower) * (c.status === 'dull' ? w.dullFactor : 1) + w.forwardPresence
+    if (c.status === 'active') v += (total / 1000) * w.threat   // active-power tempo: this side's own attack-ready threat
     v += abilityTerms(state, p, c, true, w)
   }
   for (const c of ps.backups) v += abilityTerms(state, p, c, false, w)
diff --git a/packages/engine/src/activate.ts b/packages/engine/src/activate.ts
new file mode 100644
index 0000000..d576bd8
--- /dev/null
+++ b/packages/engine/src/activate.ts
@@ -0,0 +1,187 @@
+import type { PlayerId } from './types.js'
+import type { CardId, FieldCard, GameState } from './state.js'
+import { defOf, findFieldCard, updatePlayer } from './state.js'
+import type { Ability, AbilityCost } from './abilities.js'
+import type { Payment } from './commands.js'
+import type { Event } from './events.js'
+import { IllegalCommandError } from './errors.js'
+import { canPay, generateCp, pay, type CpRequirement } from './cp.js'
+import type { ZoneTransition } from './rules.js'
+import { enqueueTrigger, enqueueZoneChangeTriggers, removeFromField, targetCandidates } from './resolve.js'
+
+/**
+ * Activated abilities (spec C3): the transaction from declaration through simultaneous costs, cost triggers,
+ * and the queued action frame.
+ *
+ * The order in here is the whole point and is not arbitrary:
+ *
+ *   1. check legality — including a PREFLIGHT of the ability's targets against the POST-cost state;
+ *   2. pay every cost at once (§11.6.10) — there is no partial payment;
+ *   3. enqueue the triggers the COSTS fired;
+ *   4. enqueue the action frame LAST.
+ *
+ * Step 3 before step 4 because `drainResolution` is FIFO: an ability whose cost puts its own source into the
+ * Break Zone fires observers that must resolve above the action that paid for them.
+ */
+
+/** The CP half of an ability's cost, as a requirement independent of the card's printed cost (spec C3-4). */
+export function abilityCpRequirement(source: CardId, cost: AbilityCost): CpRequirement {
+  return {
+    amount: cost.cp?.amount ?? 0,
+    requiredElements: cost.cp?.requiredElements ?? [],
+    // The source can never help pay for itself — see `generateCp`.
+    excluded: [source],
+  }
+}
+
+/** Locate an activated clause by its stable id. Returns null when the card has no such clause. */
+export function activatedAbility(state: GameState, source: CardId, abilityId: string): Ability | null {
+  const def = defOf(state, source)
+  const ability = (def.abilities ?? []).find((a) => a.id === abilityId)
+  if (!ability || ability.trigger.kind !== 'activated') return null
+  return ability
+}
+
+/** Where the card actually is, from the activating player's side only. */
+function sourceZoneOf(state: GameState, player: PlayerId, source: CardId): 'field' | 'hand' | 'breakZone' | null {
+  const ps = state.players[player]
+  if (ps.hand.includes(source)) return 'hand'
+  if (ps.breakZone.includes(source)) return 'breakZone'
+  const loc = findFieldCard(state, source)
+  if (loc && loc.owner === player) return 'field'
+  return null
+}
+
+function hasHaste(state: GameState, card: FieldCard): boolean {
+  return card.granted.includes('haste') || defOf(state, card.id).keywords.includes('haste')
+}
+
+/**
+ * Why this activation is illegal, or null. Mirrors `castCheck`: `legalCommands` uses it to enumerate and
+ * `apply` uses it to reject, so the two can never disagree.
+ */
+export function activationCheck(state: GameState, player: PlayerId, source: CardId, abilityId: string): string | null {
+  if (state.result) return 'the game is over'
+  // A decision is owed; nothing else may happen until it is answered.
+  if (state.pending) return 'a decision is pending'
+  // MVP0-SIMPLIFICATION (spec C3-11): action abilities are sorcery-speed here — the turn player, in a Main
+  // Phase, only. The real rules (§9.3.1.7) also allow the Attack Phase, so this DOES cost something: Undead
+  // Princess cannot be used as a combat trick after blockers are declared. `priority` is always the turn
+  // player in MVP0, so no non-turn-player window is being lost, but that is not the same as losing nothing.
+  if (state.turnPlayer !== player) return 'you may only use abilities on your own turn'
+  if (state.phase !== 'main1' && state.phase !== 'main2') return 'you may only use abilities in a Main Phase'
+
+  const ability = activatedAbility(state, source, abilityId)
+  if (!ability || ability.trigger.kind !== 'activated') return `${abilityId} is not an activated ability of ${source}`
+  const { sourceZone, cost } = ability.trigger
+
+  const where = sourceZoneOf(state, player, source)
+  if (where === null) return `you do not have ${source}`
+  if (where !== sourceZone) return `${abilityId} may only be used from your ${sourceZone}`
+
+  if (cost.dull) {
+    // §11.6.2.2 — the dull icon, and ONLY the dull icon, brings the active/entered-this-turn/Haste rule with
+    // it. An ability without it (Undead Princess) is usable while dulled and on the turn its source arrives.
+    const loc = findFieldCard(state, source)
+    if (!loc) return 'only a card on the field can be dulled'
+    if (loc.card.status !== 'active') return `${source} is already dull`
+    if (loc.card.enteredTurn === state.turn && !hasHaste(state, loc.card)) {
+      return `${source} entered the field this turn (§11.6.2.2)`
+    }
+  }
+  if (cost.selfToBreakZone && !findFieldCard(state, source)) return 'only a card on the field can be put into the Break Zone'
+  if (cost.selfDiscard && !state.players[player].hand.includes(source)) return 'only a card in your hand can be discarded'
+
+  // Preflight the targets against the state as it will be AFTER the costs are paid (§11.6.5).
+  const [post] = applyCosts(state, player, source, cost, { dullBackups: [], discards: [] }, /* validate */ false)
+  const first = ability.effects[0]
+  if (first?.kind === 'chooseTargets') {
+    const candidates = targetCandidates(post, source, player, first.from)
+    if (candidates.length === 0 || first.min > candidates.length) return `${abilityId} has no legal target`
+  }
+  return null
+}
+
+/**
+ * Apply every non-CP cost, plus (when `validate`) the CP payment. Returns the new state, its events, and any
+ * zone transitions the cost produced.
+ *
+ * Used twice: once with an empty payment and `validate: false` to preflight targets, and once for real. The
+ * preflight deliberately skips CP because CP does not move the source card and so cannot change who is a
+ * legal target.
+ */
+function applyCosts(
+  state: GameState, player: PlayerId, source: CardId, cost: AbilityCost, payment: Payment, validate: boolean,
+): [GameState, Event[], ZoneTransition[]] {
+  let s = state
+  const events: Event[] = []
+  const transitions: ZoneTransition[] = []
+
+  if (validate) {
+    const req = abilityCpRequirement(source, cost)
+    const cp = generateCp(s, player, payment, req.excluded)
+    if (!canPay(req.amount, req.requiredElements, cp)) {
+      throw new IllegalCommandError(`payment does not cover cost ${req.amount} ${req.requiredElements.join('/')}`)
+    }
+    const [paid, payEvents] = pay(s, player, payment)
+    s = paid
+    events.push(...payEvents)
+  }
+
+  if (cost.dull) {
+    s = setStatus(s, source, 'dull')
+    events.push({ type: 'activated', player, cards: [source] })
+  }
+  if (cost.selfToBreakZone) {
+    const loc = findFieldCard(s, source)
+    if (loc) {
+      // NOT a break (§15.1.1.3.2): `cannotBeBroken` is not consulted and no `broken` event is emitted. It IS
+      // a zone movement, so the transition is produced and observers of "put from the field into the Break
+      // Zone" — which is the printed wording the implemented watcher encodes — still see it (spec C3-7).
+      const owner = s.cards[source]?.owner ?? loc.owner
+      transitions.push({
+        card: source, controller: loc.owner, owner,
+        from: loc.zone === 'backups' ? 'backups' : 'forwards', to: 'breakZone', reason: 'cost',
+        cause: source, causeController: player, snapshot: loc.card,
+      })
+      s = updatePlayer(removeFromField(s, source), owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
+      events.push({ type: 'paidToBreakZone', player, card: source })
+    }
+  }
+  if (cost.selfDiscard) {
+    const owner = s.cards[source]?.owner ?? player
+    s = updatePlayer(s, player, (ps) => ({ ...ps, hand: ps.hand.filter((id) => id !== source) }))
+    s = updatePlayer(s, owner, (ps) => ({ ...ps, breakZone: [...ps.breakZone, source] }))
+    events.push({ type: 'discarded', player, card: source, reason: 'cp' })
+  }
+  return [s, events, transitions]
+}
+
+function setStatus(state: GameState, card: CardId, status: 'active' | 'dull'): GameState {
+  const loc = findFieldCard(state, card)
+  if (!loc) return state
+  return updatePlayer(state, loc.owner, (ps) => ({
+    ...ps,
+    forwards: ps.forwards.map((c) => (c.id === card ? { ...c, status } : c)),
+    backups: ps.backups.map((c) => (c.id === card ? { ...c, status } : c)),
+  }))
+}
+
+export function applyActivateAbility(
+  state: GameState, player: PlayerId, source: CardId, abilityId: string, payment: Payment,
+): [GameState, Event[]] {
+  const why = activationCheck(state, player, source, abilityId)
+  if (why) throw new IllegalCommandError(why)
+  const ability = activatedAbility(state, source, abilityId)
+  if (!ability || ability.trigger.kind !== 'activated') throw new IllegalCommandError('unreachable: checked above')
+
+  const pre = state   // observers are read PRE-move, exactly as `breakCard` does
+  const [paid, events, transitions] = applyCosts(state, player, source, ability.trigger.cost, payment, true)
+  events.unshift({ type: 'abilityActivated', player, card: source, abilityId })
+
+  // Cost triggers BEFORE the action frame: `drainResolution` is FIFO, and the observers a cost fires resolve
+  // above the ability that paid them (spec C3-8).
+  let s = enqueueZoneChangeTriggers(pre, paid, transitions)
+  s = enqueueTrigger(s, source, player, ability)
+  return [s, events]
+}
diff --git a/packages/engine/src/resolve.ts b/packages/engine/src/resolve.ts
index 214bd7c..9c00742 100644
--- a/packages/engine/src/resolve.ts
+++ b/packages/engine/src/resolve.ts
@@ -1,6 +1,7 @@
 import type { Ability, AbilityTrigger, Effect, Frame, TargetFilter, TargetSpec, TriggerEvent, TriggerWhose } from './abilities.js'
 // Type-only, so it is erased at compile time and creates no runtime cycle with rules.ts (which imports this module).
 import type { ZoneTransition } from './rules.js'
+import { drawCards } from './draw.js'
 import { MAX_RESOLUTION_STEPS } from './abilities.js'
 import type { CardId, FieldCard, GameState, Pending } from './state.js'
 import { findFieldCard, updatePlayer } from './state.js'
@@ -155,7 +156,7 @@ function setFieldCard(state: GameState, id: CardId, f: (c: FieldCard) => FieldCa
     : { ...ps, backups: ps.backups.map((c) => (c.id === id ? f(c) : c))}))
 }
 
-function removeFromField(state: GameState, id: CardId): GameState {
+export function removeFromField(state: GameState, id: CardId): GameState {
   const loc = findFieldCard(state, id)
   if (!loc) return state
   return updatePlayer(state, loc.owner, (ps) => (loc.zone === 'forwards'
@@ -359,6 +360,13 @@ function runEffect(ctx: Ctx, eff: Effect, depth: number, answered: boolean): voi
         ctx.events.push({ type: 'returnedToHand', player: ctx.state.cards[id]?.owner ?? ctx.controller, card: id })
       }
       return
+    case 'draw': {
+      // The ability's CONTROLLER draws, not the turn player: Miner's draw is Miner's controller's.
+      const [drawn, drawEvents] = drawCards(ctx.state, ctx.controller, eff.count)
+      ctx.state = drawn
+      ctx.events.push(...drawEvents)
+      return
+    }
     default: { const _exhaustive: never = eff; return _exhaustive }
   }
 }
@@ -574,7 +582,7 @@ function enqueueZoneTriggers(state: GameState, occurrences: readonly WatcherOccu
   let s = state
   for (const o of occurrences) {
     const t = o.transition
-    const event: TriggerEvent = { kind: 'zoneChange', card: t.card, from: 'field', to: 'breakZone', controller: t.controller, owner: t.owner }
+    const event: TriggerEvent = { kind: 'zoneChange', card: t.card, from: 'field', to: 'breakZone', controller: t.controller, owner: t.owner, reason: t.reason }
     s = enqueueTrigger(s, o.source, o.controller, o.ability, event)
   }
   return s

exec
/bin/zsh -lc 'nl -ba packages/engine/test/cr11.2-cp.test.ts && rg -n "C3|activated|activation" README.md docs packages apps | head -240' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	import { describe, expect, it } from 'vitest'
     2	import { canPay, enumeratePayments, generateCp, pay, requiredElements } from '../src/cp.js'
     3	import { applyCastCharacter } from '../src/cast.js'
     4	import { IllegalCommandError } from '../src/errors.js'
     5	import { VANILLA_POOL, makeDef, makeGame, withField, withHand } from './helpers.js'
     6	
     7	function setup() {
     8	  let s = makeGame()
     9	  s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
    10	  let b1: number, b2: number, h1: number, h2: number, target: number
    11	  ;[s, b1] = withField(s, 0, 'backups', 'V-B1')                       // earth, active
    12	  ;[s, b2] = withField(s, 0, 'backups', 'V-B2', { status: 'dull' })   // lightning, dull
    13	  ;[s, h1] = withHand(s, 0, 'V-F3')                                   // lightning card in hand
    14	  ;[s, h2] = withHand(s, 0, 'V-F4')                                   // earth/lightning card in hand
    15	  ;[s, target] = withHand(s, 0, 'V-F2')                               // earth cost 2 — the card we are casting
    16	  return { s, b1, b2, h1, h2, target }
    17	}
    18	
    19	describe('§11.2 generating CP', () => {
    20	  it('dulling an active backup gives 1 CP of its element; discarding gives 2', () => {
    21	    const { s, b1, h1, target } = setup()
    22	    expect(generateCp(s, 0, { dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] }, target))
    23	      .toEqual([{ element: 'earth', source: b1 }, { element: 'lightning', source: h1 }, { element: 'lightning', source: h1 }])
    24	  })
    25	  it('a dull backup cannot generate CP', () => {
    26	    const { s, b2, target } = setup()
    27	    expect(() => generateCp(s, 0, { dullBackups: [b2], discards: [] }, target)).toThrow(IllegalCommandError)
    28	  })
    29	  it('a multi-element discard must declare one of its own elements', () => {
    30	    const { s, h2, target } = setup()
    31	    expect(generateCp(s, 0, { dullBackups: [], discards: [{ card: h2, element: 'earth' }] }, target)[0]?.element).toBe('earth')
    32	    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: h2, element: 'fire' }] }, target)).toThrow(IllegalCommandError)
    33	  })
    34	  it('the card being cast cannot be discarded to pay for itself', () => {
    35	    const { s, target } = setup()
    36	    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: target, element: 'earth' }] }, target)).toThrow(IllegalCommandError)
    37	  })
    38	})
    39	
    40	describe('§11.2.2 paying a cost', () => {
    41	  const E = (e: 'earth' | 'lightning', n = 1) => Array.from({ length: n }, (_, i) => ({ element: e, source: 100 + i }))
    42	  it('needs at least one CP of the card\'s element', () => {
    43	    expect(canPay(2, ['earth'], E('lightning', 2))).toBe(false)
    44	    expect(canPay(2, ['earth'], [...E('earth'), ...E('lightning')])).toBe(true)
    45	  })
    46	  it('§11.2.2.3: excess CP is allowed and wasted', () => {
    47	    expect(canPay(1, ['earth'], [...E('earth'), ...E('lightning', 2)])).toBe(true)
    48	  })
    49	  it('§11.2.2.1: multi-element cards need one CP of each element', () => {
    50	    expect(canPay(2, ['earth', 'lightning'], E('earth', 2))).toBe(false)
    51	    expect(canPay(2, ['earth', 'lightning'], [...E('earth'), ...E('lightning')])).toBe(true)
    52	  })
    53	  it('§11.2.2.4: cost 0 must not generate CP', () => {
    54	    expect(canPay(0, ['earth'], [])).toBe(true)
    55	    expect(canPay(0, ['earth'], E('earth'))).toBe(false)
    56	  })
    57	})
    58	
    59	describe('enumeratePayments', () => {
    60	  it('lists only minimal payments and never uses the cast card, dull backups or the wrong element alone', () => {
    61	    const { s, b1, h1, h2, target } = setup()
    62	    const ps = enumeratePayments(s, 0, target)   // earth, cost 2
    63	    // legal minimal: {b1 + discard h1 as lightning}, {discard h2 as earth}, {b1 + discard h2 as lightning}; {b1 + h2 as earth} is NOT minimal (h2 alone pays)
    64	    expect(ps).toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] })
    65	    expect(ps).toContainEqual({ dullBackups: [], discards: [{ card: h2, element: 'earth' }] })
    66	    expect(ps).toContainEqual({ dullBackups: [b1], discards: [{ card: h2, element: 'lightning' }] })
    67	    expect(ps).not.toContainEqual({ dullBackups: [], discards: [{ card: h1, element: 'lightning' }] })   // no earth CP
    68	    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }, { card: h2, element: 'earth' }] }) // not minimal
    69	    expect(ps).not.toContainEqual({ dullBackups: [b1], discards: [{ card: h2, element: 'earth' }] })   // h2-as-earth alone already pays → not minimal
    70	    for (const p of ps) expect(p.discards.some((d) => d.card === target)).toBe(false)
    71	  })
    72	  it('returns [] when the cost cannot be met', () => {
    73	    let s = makeGame(); let t: number
    74	    s = { ...s, players: [{ ...s.players[0], hand: [] }, s.players[1]] }
    75	    ;[s, t] = withHand(s, 0, 'V-F3')   // cost 3, nothing else in hand, no backups
    76	    expect(enumeratePayments(s, 0, t)).toEqual([])
    77	  })
    78	})
    79	
    80	describe('C3: requiredElements — §11.2.1.1/§11.2.2 Light/Dark same-element exemption', () => {
    81	  it('is [] for a pure Light or pure Dark card, unchanged elements otherwise', () => {
    82	    expect(requiredElements(makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 }))).toEqual([])
    83	    expect(requiredElements(makeDef({ code: 'V-D1', elements: ['dark'], cost: 2, power: 5000 }))).toEqual([])
    84	    expect(requiredElements(makeDef({ code: 'V-E1', elements: ['earth'], cost: 2, power: 5000 }))).toEqual(['earth'])
    85	    expect(requiredElements(makeDef({ code: 'V-EL1', elements: ['earth', 'lightning'], cost: 2, power: 5000 }))).toEqual(['earth', 'lightning'])
    86	  })
    87	  it('a cost-2 Light forward is castable with two off-element (earth) backups', () => {
    88	    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
    89	    let s = makeGame({ defs }); let b1: number, b2: number, card: number
    90	    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')   // earth
    91	    ;[s, b2] = withField(s, 0, 'backups', 'V-B3')   // earth
    92	    ;[s, card] = withHand(s, 0, 'V-L1')
    93	    const [t] = applyCastCharacter(s, 0, card, { dullBackups: [b1, b2], discards: [] })
    94	    expect(t.players[0].forwards.some((c) => c.id === card)).toBe(true)
    95	  })
    96	  it('Light/Dark cards still cannot be discarded for CP (§11.2.1.1) even though they need no same-element CP', () => {
    97	    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
    98	    let s = makeGame({ defs }); let light: number, target: number
    99	    ;[s, light] = withHand(s, 0, 'V-L1')
   100	    ;[s, target] = withHand(s, 0, 'V-F2')   // earth cost 2
   101	    expect(() => generateCp(s, 0, { dullBackups: [], discards: [{ card: light, element: 'earth' }] }, target)).toThrow(IllegalCommandError)
   102	  })
   103	})
   104	
   105	describe('pay', () => {
   106	  it('dulls backups and moves discards to the break zone', () => {
   107	    const { s, b1, h1 } = setup()
   108	    const [t, events] = pay(s, 0, { dullBackups: [b1], discards: [{ card: h1, element: 'lightning' }] })
   109	    expect(t.players[0].backups.find((c) => c.id === b1)?.status).toBe('dull')
   110	    expect(t.players[0].hand).not.toContain(h1)
   111	    expect(t.players[0].breakZone).toContain(h1)
   112	    expect(events[0]).toEqual({ type: 'cpGenerated', player: 0, cp: ['earth', 'lightning', 'lightning'] })
   113	    expect(events[1]).toEqual({ type: 'discarded', player: 0, card: h1, reason: 'cp' })
   114	    expect(events).toHaveLength(2)
   115	  })
   116	})
README.md:26:rather than a silent surprise. Finishing them is rung C3.
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:37:activated abilities — Red Mage's `[Lightning][Dull]`, Noel's `[Dull], put into the Break Zone`, Miner's
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:43:Eight clauses behind one primitive beats two clauses behind four blockers, and activated abilities are also
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:92:| C3-1 | **Knowledge is per player, and lives in the view's deck** | `FieldView.deckCount: number` becomes `FieldView.deck: readonly (CardId \| null)[]` — one slot per card, non-null **only** where that viewer legitimately knows what is there. The count is `deck.length`, so nothing is lost. This is the minimal representation that can express "I know my top 3 but not my fourth", which is precisely what Reeve creates. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:93:| C3-2 | **`determinise` pins what is known and samples the rest** | Non-null slots keep their id and code and are removed from the unseen multiset before shuffling, exactly as field and hand cards already are (`determinise.ts:38`). Everything else is sampled as today. Without this, an AI that looked at its own top 3 would re-randomise them the instant it tried to think about them — the search would be reasoning about a deck it had just been told it did not have. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:94:| C3-3 | **`viewFor` redacts pending candidates the viewer cannot see** | A `chooseTargets` whose candidates include hidden cards is filtered to those visible **to that viewer**, and carries `hidden: number` for the remainder. The opponent of a Reeve therefore sees "choosing 1 of 3 cards" and no identities. Redaction happens at the view boundary, not at the prompt, because the view boundary is the only place that knows who is asking. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:95:| C3-4 | **A private choice by the OPPONENT must key on what was observed, not on what was sampled** | In ISMCTS, an opponent's private deck choice is re-sampled every determinisation. Keyed by card identity, one real decision would shatter into dozens of tree nodes that the searcher can never tell apart in play — and each would be conditioned on information the searcher does not have. Action keys for a non-root player's private choice collapse to the observable form (`take 1 of N from deck`). This is the D2 review's warning that "Reeve's private look invalidates the search's assumption that every action becomes public", answered. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:96:| C3-5 | **`reveal` and `look at` are one primitive with a visibility flag** | `lookAt { count, visibility: 'public' \| 'private', filter, take }`. Public grants the knowledge to both players, private only to the controller. Building these as two effects would duplicate the ordering, filtering and bottoming logic to express a difference of one field. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:97:| C3-6 | **MVP0-SIMPLIFICATION: "in any order" becomes a fixed order** | The rest go to the bottom in their revealed order; the player is not asked to arrange them. Asking would add a permutation decision (4 cards = 24 orderings) to every Miner, for cards going to the **bottom of a 40+ card deck**, which in a game this length will almost never be drawn. Marked `MVP0-SIMPLIFICATION` at the site with this reasoning, and listed in the README's deviations. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:98:| C3-7 | Not in scope | **Hugh Yurg** (searches the *whole* deck, and *plays* the card onto the field rather than taking it to hand — that needs a put-into-play-without-paying effect); **Cloud's Attack-Phase clause** (needs attack entry split into preparation + continuation); EX Burst; Sphene; the "in any order" prompt. |
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:115:- **C3-A1** Miner's ETB reveals the top 5 publicly, adds a chosen **Backup** among them to hand, and bottoms
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:117:- **C3-A2** Reeve's ETB shows the top 3 **to its controller only**, adds a chosen card to hand, bottoms the
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:120:- **C3-A3 (the determinisation guard)** From a view in which the controller knows its top 3, `determinise`
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:123:- **C3-A4 (no leak through the search)** Two determinisations of the same opponent-private choice produce the
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:125:- **C3-A5** A deck with fewer cards than the reveal count reveals what is there and does not throw; an empty
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:127:- **C3-A6** `ABILITY_CLAUSES` for both cards drops by one clause each, the amber "not implemented" warning
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:129:- **C3-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer
packages/engine/src/legal.ts:6:import { abilityCpRequirement, activationCheck } from './activate.js'
packages/engine/src/legal.ts:66:      for (const c of activationsFor(state, player)) out.push(c)
packages/engine/src/legal.ts:84: * Every legal activation for `player`, one per (source card, clause, minimal payment).
packages/engine/src/legal.ts:86: * Scans the three zones an activated ability can live in rather than just the field: `sourceZone` is a
packages/engine/src/legal.ts:87: * declared precondition on the ability (spec C3-3), so Geomancer's hand-only ability and a future Break-Zone
packages/engine/src/legal.ts:90:function activationsFor(state: GameState, player: PlayerId): Command[] {
packages/engine/src/legal.ts:96:      if (ability.trigger.kind !== 'activated') continue
packages/engine/src/legal.ts:97:      if (activationCheck(state, player, source, ability.id) !== null) continue
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:1:# Rung C3 — Activated abilities: giving the player something to *do* with the board
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:5:> `docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md`. This rung replaced a
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:27:**This is the rung a human notices.** Ten triggered clauses make a board that happens to you; activated
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:44:| C3-1 | **`activateAbility { player, source, abilityId, payment, targets }`** | Targets are declared **with** the activation, not discovered after the frame starts. `resolve.ts:235` treats an empty target set as a successful no-op, which is right for a triggered ability and wrong here: it would let Undead Princess pay her whole cost — breaking herself — for nothing. Activation is one transaction: legal targets, or not legal at all. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:45:| C3-2 | **`abilityId`, never an array index** | `Ability.id` already exists as a stable per-clause identity (`abilities.ts:121`). Indices would break precisely because of this rung's own ordering: Miner's action is its *second* printed clause but would sit at index 0 while its ETB is deferred to C6, then silently shift when C6 lands. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:46:| C3-3 | **`sourceZone: 'field' \| 'hand' \| 'breakZone'` is first-class now** | An activation precondition, not a cost. Inferring "on the field" from the presence of a `[Dull]` cost would need replacing immediately for the two hand Backups and again for C4's Break-Zone clause. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:47:| C3-4 | **Generalize the CP machinery, keep `Payment`** | `Payment` describes CP *sources* and is fine. What cannot be reused is the cast validator, which derives amount and elements from the card definition (`cast.ts:33`): Red Mage's ability costs `[Lightning]` = 1 Lightning while the card's printed cost is 2, and Miner's costs a generic `[2]` while the card is a 3. So: `{ amount, requiredElements: Element[], excludedSources: CardId[] }`, shared by casting, enumeration, `preferredPayment` and activation. `[0]` admits only the empty payment. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:48:| C3-5 | **Exclusions apply to dulled Backups too, not only discards** | `generateCp` excludes `casting` in the discard loop and **not** in the Backup loop (`cp.ts:24`–`cp.ts:34`). Left alone, Red Mage would dull *itself* to make its own Lightning CP and pay its `[Dull]` cost with the same action — one dull, two costs. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:49:| C3-6 | **`[Dull]` restrictions gate on the cost containing `[Dull]`** | Active status, entered-this-turn and the Haste exception apply only when the cost has the dull icon. Undead Princess's cost is *only* "put into the Break Zone", so she may activate **while dull and on the turn she enters** — revision 1's acceptance criterion said otherwise and was simply wrong. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:50:| C3-7 | **A self-break cost is not a break, but it IS a zone movement** | Revision 1 contradicted itself here. The implemented observer's printed text is "is **put from the field into the Break Zone**" (`cards/src/abilities.ts:220`) and `watches` ignores the transition reason by design, so paying this cost **must** trigger Lightning. What must not be emitted is a `broken` / `brokenByAbility` / `breakPrevented` event, and `cannotBeBroken` must not prevent the payment. Add `ZoneTransition.reason: 'cost'` so a future "when broken" observer can filter, and fix `describeTriggerCause`, which currently narrates every zone move as "was broken" (`apps/web/src/game/commands.ts:60`). |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:51:| C3-8 | **Cost triggers are enqueued BEFORE the action frame** | `drainResolution` is FIFO (`resolve.ts:413`). An ability whose cost breaks its own source generates watcher triggers that must resolve *above* the action they paid for. "Pay, then push the frame" is only correct if the cost's transitions are handed to `enqueueZoneChangeTriggers` first. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:52:| C3-9 | **Add `{ kind: 'draw'; count }` and move `drawCards` somewhere neutral** | Revision 1 claimed all four effect halves needed no new machinery. False: `Effect` has no draw, and the only draw primitive lives in `phases.ts`, which `resolve.ts` cannot import because `phases.ts` already imports `resolve.ts` (`phases.ts:8`). Extract `drawCards` — empty-deck loss semantics (§3.1.2) intact — into a module both can import. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:53:| C3-10 | **The AI must be given activations explicitly** | Revision 1 said the AI gets them "for free" from `legalCommands`. It does not: `candidateCommands` hand-builds casts and `pass` in the Main Phases (`candidates.ts:295`) and the search enumerates *that* list. Activation needs its own emission (one preferred-payment activation per `(source, abilityId, target set)`), plus `ActionKey` encode/decode and the synthetic-id guard. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:54:| C3-11 | **MVP0-SIMPLIFICATION: turn player, Main Phase 1 or 2 only — and this one costs something** | Revision 1 claimed this was "not a further loss of fidelity". Wrong: the CR allows action abilities in the Attack Phase too, and the engine even has an unblocked turn-player action point at attack declaration (`legal.ts:68`). Noel and Red Mage still work from Main 1 before attacking, but **Undead Princess stops being a combat trick** — she cannot pump after blockers are declared. Stated plainly as "action abilities are sorcery-speed", marked at the site, and listed in the README's deviations. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:55:| C3-12 | Not in scope | Undead Princess's second clause and the removed-from-game zone; Sphene; EX Burst; static abilities (Class Tenth Moogle's CP, Odin's cost reduction, Sphene's protection); deck knowledge (C6). |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:60:ones are: **§§11.6.3–11.6.11** activation procedure, **§11.6.10** cost atomicity, **§11.6.5** targeting at
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:61:activation, **§11.5.4** source independence, **§11.6.2.2** the `[Dull]` control-since-start / Haste rule,
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:76:  `powerBonus` that cannot affect combat before it expires, plus explicit "pass over the useless activation"
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:83:  as a separate choice. Casts and activations both need to be treated as "payable commands".
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:87:- **C3-A1 (reachability)** Every one of the six clauses is reachable from `legalCommands` **and** emitted by
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:89:  be shown actually choosing an activation at least once.
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:90:- **C3-A2 (atomicity)** Noel's effect dulls every opponent Forward even though its cost has already put Noel
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:92:- **C3-A3 (cost triggers first)** Paying Noel's self-break cost with an opponent Lightning in play resolves
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:94:- **C3-A4 (cost is not a break)** A source with `cannotBeBroken` can still pay a self-break cost; the
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:97:- **C3-A5 (legality, as constructed unit tests, not a sweep)** Separately: `[Dull]` costs are illegal from a
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:100:  or a discard; an activation with no legal target is absent from `legalCommands` entirely; and activation is
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:103:- **C3-A6 (`ABILITY_CLAUSES` must NOT change)** It counts *printed* clauses, implemented or not
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:107:- **C3-A7 (browser)** Activations appear as ordinary choices on their source card, labelled with the printed
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:108:  cost, with payment variants collapsed to one button; narration says the ability was **activated**, not
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:110:- **C3-A8** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer 200/200
apps/cli/src/weights-ab.ts:10: * Edit `OLD` to whatever you are comparing against. It currently pins the pre-C3 behaviour, where power that
apps/cli/src/render.ts:62:/** The printed cost of one activated clause, for the command label. */
apps/cli/src/render.ts:66:  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'ability'
docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:43:| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
packages/engine/src/commands.ts:19:   * Use an activated ability (spec C3-1).
packages/engine/src/commands.ts:22:   * against the state as it will be once the costs are paid, and the activation is illegal unless a legal
packages/engine/src/draw.ts:8: * Drawing, in a module that depends on nothing but state (spec C3-9).
packages/engine/src/activate.ts:13: * Activated abilities (spec C3): the transaction from declaration through simultaneous costs, cost triggers,
packages/engine/src/activate.ts:27:/** The CP half of an ability's cost, as a requirement independent of the card's printed cost (spec C3-4). */
packages/engine/src/activate.ts:37:/** Locate an activated clause by its stable id. Returns null when the card has no such clause. */
packages/engine/src/activate.ts:38:export function activatedAbility(state: GameState, source: CardId, abilityId: string): Ability | null {
packages/engine/src/activate.ts:41:  if (!ability || ability.trigger.kind !== 'activated') return null
packages/engine/src/activate.ts:60: * Why this activation is illegal, or null. Mirrors `castCheck`: `legalCommands` uses it to enumerate and
packages/engine/src/activate.ts:63:export function activationCheck(state: GameState, player: PlayerId, source: CardId, abilityId: string): string | null {
packages/engine/src/activate.ts:67:  // MVP0-SIMPLIFICATION (spec C3-11): action abilities are sorcery-speed here — the turn player, in a Main
packages/engine/src/activate.ts:74:  const ability = activatedAbility(state, source, abilityId)
packages/engine/src/activate.ts:75:  if (!ability || ability.trigger.kind !== 'activated') return `${abilityId} is not an activated ability of ${source}`
packages/engine/src/activate.ts:133:    events.push({ type: 'activated', player, cards: [source] })
packages/engine/src/activate.ts:140:      // Zone" — which is the printed wording the implemented watcher encodes — still see it (spec C3-7).
packages/engine/src/activate.ts:173:  const why = activationCheck(state, player, source, abilityId)
packages/engine/src/activate.ts:175:  const ability = activatedAbility(state, source, abilityId)
packages/engine/src/activate.ts:176:  if (!ability || ability.trigger.kind !== 'activated') throw new IllegalCommandError('unreachable: checked above')
packages/engine/src/activate.ts:183:  // above the ability that paid them (spec C3-8).
packages/engine/src/abilities.ts:69:   * than `phases.ts`, because `phases.ts` imports `resolve.ts` and so cannot be imported back (spec C3-9).
packages/engine/src/abilities.ts:98: * `enterField` covers casting AND being put onto the field by another ability (C3's Hugh Yurg), which is
packages/engine/src/abilities.ts:118:   * NOT a trigger at all: an ability the player chooses to use (spec C3-1). It lives in this union because
packages/engine/src/abilities.ts:119:   * every dispatch site already switches on `kind`, so an activated ability is inertly ignored by trigger
packages/engine/src/abilities.ts:122:   * `sourceZone` is an activation PRECONDITION, not part of the cost (C3-3): Geomancer's ability is usable
packages/engine/src/abilities.ts:126:  | { readonly kind: 'activated'; readonly sourceZone: ActivationSourceZone; readonly cost: AbilityCost }
packages/engine/src/abilities.ts:134: * What activating costs. Every part is paid at once or the activation is not legal at all (§11.6.10) — there
packages/engine/src/abilities.ts:154:   * Break Zone" must still see it (spec C3-7).
packages/engine/src/abilities.ts:169:   * Break Zone used to be described as "was broken", which stopped being true in C3: a card put there to PAY
packages/engine/src/index.ts:21:export * from './draw.js'       // Rung C3: drawing, importable from both phases and resolution
packages/engine/src/index.ts:22:export * from './activate.js'   // Rung C3: activated abilities
packages/engine/src/cp.ts:23: * being cast; for an activated ability it is the ability's own source (spec C3-5), and there it matters in a
packages/engine/src/cp.ts:66: * What a payment has to cover, decoupled from any card's printed cost (spec C3-4).
packages/engine/src/phases.ts:9:// Re-exported so every existing importer of `drawCards` from this module keeps working (spec C3-9).
packages/engine/src/phases.ts:25:  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
packages/engine/src/events.ts:10:  | { type: 'activated'; player: PlayerId; cards: CardId[] }
packages/engine/src/events.ts:15:  /** An activated ability was used (spec C3-1) — activated, NOT triggered; the log must not conflate them. */
docs/superpowers/specs/2026-08-26-heuristic-ai-design.md:38:- **A4**: the built signature is `preferredPayment(state, player, card)` — it operates on a full (determinised) `GameState`, not a bare `PlayerView`, because it needs backup/hand card definitions and `canPay`/`generateCp` from the engine. It also resolves multi-element costs via `requiredElements(def)` (§11.2.1.1 Light/Dark exemption, C3) and bounded backtracking over the required elements (C2, final fix wave) — not simply "dull backups then discard" in element order, and not a single scarcity-first greedy pass either: a single pass, even scarcest-element-first, can still strand a later element when the cheapest per-element pick spends a source only that element's rescue depended on (Codex's 3-element counterexample). Backtracking explores every source-to-element assignment and keeps the cheapest complete one.
packages/engine/src/rules.ts:51:   * a card put into the Break Zone to PAY for its own activated ability (spec C3-7).
docs/superpowers/specs/2026-08-25-fftcg-game-design.md:75:- Ability = trigger (`onEnterField`, `onAttack`, `activated`, `static`, `exBurst`, …) + a
docs/superpowers/specs/2026-08-25-fftcg-game-design.md:103:| **MVP3** | Abilities I | Generator ability system + primitives; first ~third of Vol. 2 cards scripted (ETB damage, activated abilities, EX Burst, simple statics). Coverage script. | 4–5 |
apps/cli/test/agents.test.ts:112:// Rung C3 — the agents must actually USE activated abilities
apps/cli/test/agents.test.ts:115:describe('activated abilities reach the agents (C3-A1)', () => {
apps/cli/test/agents.test.ts:118:  // test that would have failed. It asserts the agents CHOOSE an activation over a real sweep, not merely that
apps/cli/test/agents.test.ts:138:  it('greedy chooses an activation at least once across the sweep', () => {
apps/cli/test/agents.test.ts:139:    expect(chosen.size, 'no agent ever used an activated ability — they are legal but unreachable').toBeGreaterThan(0)
apps/cli/test/agents.test.ts:142:  it('every activation it chose is one of the six C3 clauses', () => {
apps/cli/test/agents.test.ts:143:    const C3 = ['1-121C:haste', '16-092C:dull-all', '18-064C:draw', '18-069C:draw', '19-052C:pump', '20-074C:draw']
apps/cli/test/agents.test.ts:144:    for (const id of chosen.keys()) expect(C3).toContain(id)
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:28:| Action abilities (`[Dull]:`, `[Earth], discard:`), costs, once-per-turn | Red Mage, Geomancer, Sphene, Miner | C3 |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:29:| EX Burst on damage | Odin, Noel, Reeve, Lightning | C3 |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:32:That last row was missing from revision 1 and has no home in C1–C3; it is now rung C4.
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:48:| C1-11 | Not in scope | Everything in the C2/C3/C4 rows above, the stack and response windows, and Limit Break (skipped program-wide). |
docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:105:- **Card set changed.** Lightning is out (its EX Burst and zone-change trigger belong to C2/C3); **Ramuh
docs/superpowers/plans/2026-08-25-mvp0-bones.md:330:  | { type: 'activated'; player: PlayerId; cards: CardId[] }
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1317:    expect(events).toContainEqual({ type: 'activated', player: 0, cards: [a] })
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1476:  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-25-mvp0-bones.md:3220:- **MVP0-SIMPLIFICATION markers (exhaustive):** priority never passes (state.ts); Summons main-phase-only (cast.ts); mulligan order (setup.ts); attack preparation auto-advance (phases.ts); damage step auto-advance and no First Strike (attack.ts); Summons resolve with no effect (cast.ts); EX Burst skipped (rules.ts); 6th Backup illegal rather than rule-processed (cast.ts); multi-element backups produce their first element (cp.ts); same-name cast refusal (§7.7.3/§12.4.6) (cast.ts); Monster-type cards unsupported (cast.ts). ~~Light/Dark CP exemption (cp.ts)~~ — implemented in the rung-A final fix wave (2026-08-26, C3): see `requiredElements(def)` in `cp.ts`; no longer a gap, marker removed.
packages/cards/test/abilities.test.ts:94:  /** The EX BURST tag is C3; the trigger itself fires on a normal cast, which is what `enterField` means. */
packages/cards/test/abilities.test.ts:129:  it('warns about nothing now that C3 landed its second clause', () => {
packages/cards/test/abilities.test.ts:130:    // Until rung C3 this asserted the opposite: Noel's "[Dull], put Noel into the Break Zone: Dull all the
packages/cards/test/abilities.test.ts:473:    // Five from rung C1, five from C2, six from C3's activated abilities. Any clause added without a test
packages/cards/test/abilities.test.ts:488:  // Spec C3-A6: `ABILITY_CLAUSES` counts PRINTED clauses, implemented or not, so landing a clause must NOT
apps/web/src/game/useGame.ts:82:    // C3: ACTIVATED, not triggered. The distinction is the whole of what this rung added for the player —
apps/web/src/game/useGame.ts:100:    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
apps/web/src/game/useGame.ts:198:      // C3: paying a cost moves a card the same way a break does, so an observer of the MOVEMENT fires on it
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:96:## What C2 actually built, and what C3 inherits (from the C2 code review)
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:98:Recorded so C3 does not start from a false assumption, the way C2 nearly did:
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:104:  has no observer source until it exists**, and that is a C3 clause. Build the transition-producing
packages/engine/test/cr9-phases.test.ts:14:    expect(events).toContainEqual({ type: 'activated', player: 0, cards: [a] })
packages/cards/src/abilities.ts:28: * one plus an activated one (Odin, Sphene) count both.
packages/cards/src/abilities.ts:57: * itself is rung C3: this clause fires on a NORMAL cast, which is what `enterField` means. Noel's second
packages/cards/src/abilities.ts:58: * clause (the [Dull] action ability) is C3 and keeps warning — hence `ABILITY_CLAUSES['16-092C'] === 2`.
packages/cards/src/abilities.ts:309:// Activated abilities (spec C3)
packages/cards/src/abilities.ts:314: * `'activated'` — not a trigger at all, but it lives in that union so trigger dispatch inertly ignores it and
packages/cards/src/abilities.ts:328:    kind: 'activated', sourceZone: 'field',
packages/cards/src/abilities.ts:330:    // CP and the [Dull]. `generateCp` excludes it (spec C3-5).
packages/cards/src/abilities.ts:345: * controls" resolves, Noel is in the Break Zone — the effect must still resolve in full (spec C3-A2).
packages/cards/src/abilities.ts:350:  trigger: { kind: 'activated', sourceZone: 'field', cost: { dull: true, selfToBreakZone: true } },
packages/cards/src/abilities.ts:358: * this array (spec C3-2): an index would silently shift when the ETB lands.
packages/cards/src/abilities.ts:362:  trigger: { kind: 'activated', sourceZone: 'field', cost: { cp: { amount: 2 }, dull: true, selfToBreakZone: true } },
packages/cards/src/abilities.ts:371: * field when targets are computed, so she cannot pump herself, and if she is the only Forward the activation
packages/cards/src/abilities.ts:376:  trigger: { kind: 'activated', sourceZone: 'field', cost: { selfToBreakZone: true } },
packages/cards/src/abilities.ts:387: * is in your hand" — an activation precondition, not a cost (spec C3-3). They are otherwise identical, and
packages/cards/src/abilities.ts:393:    kind: 'activated', sourceZone: 'hand',
packages/cards/src/abilities.ts:403:    kind: 'activated', sourceZone: 'hand',
packages/engine/test/activated-abilities.test.ts:9:import { activationCheck } from '../src/activate.js'
packages/engine/test/activated-abilities.test.ts:14: * Rung C3 — the activation transaction, tested on synthetic cards.
packages/engine/test/activated-abilities.test.ts:24:  const ability: Ability = { id: `${code}:act`, trigger: { kind: 'activated', sourceZone: over.type === 'backup' ? 'field' : 'field', cost }, text: 'synthetic activated clause', effects }
packages/engine/test/activated-abilities.test.ts:28:/** A card whose ability is usable only from hand — the `sourceZone` precondition (spec C3-3). */
packages/engine/test/activated-abilities.test.ts:30:  const ability: Ability = { id: `${code}:act`, trigger: { kind: 'activated', sourceZone: 'hand', cost }, text: 'synthetic hand clause', effects }
packages/engine/test/activated-abilities.test.ts:54:// C3-A2 — the cost removes the source, and the effect still resolves in full
packages/engine/test/activated-abilities.test.ts:57:describe('cost and effect are separate (C3-A2)', () => {
packages/engine/test/activated-abilities.test.ts:101:    expect(activationCheck(s, 0, src, 'T-PUMP:act')).toMatch(/no legal target/)
packages/engine/test/activated-abilities.test.ts:110:// C3-A3 / C3-A4 — the cost's own zone movement
packages/engine/test/activated-abilities.test.ts:113:describe('a self-break cost is a zone movement but NOT a break (C3-A3/C3-A4)', () => {
packages/engine/test/activated-abilities.test.ts:157:// C3-A5 — legality, constructed rather than swept for
packages/engine/test/activated-abilities.test.ts:160:describe('activation legality (C3-A5)', () => {
packages/engine/test/activated-abilities.test.ts:168:    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toMatch(/already dull/)
packages/engine/test/activated-abilities.test.ts:176:    expect(activationCheck(s, 0, fresh, 'T-DULLCOST:act')).toMatch(/entered the field this turn/)
packages/engine/test/activated-abilities.test.ts:177:    expect(activationCheck(s, 0, hasted, 'T-DULLCOST:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:181:    // Undead Princess. The restriction rides on the icon, not on activation in general — revision 1 of the
packages/engine/test/activated-abilities.test.ts:187:    expect(activationCheck(s, 0, src, 'T-NODULL:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:190:  it('the source may not pay its own CP cost, as a dulled Backup or as a discard (C3-5)', () => {
packages/engine/test/activated-abilities.test.ts:206:  it('is illegal outside the turn player\'s Main Phases (MVP0-SIMPLIFICATION C3-11)', () => {
packages/engine/test/activated-abilities.test.ts:210:    expect(activationCheck(s, 0, src, 'T-DULLCOST:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:211:    expect(activationCheck({ ...s, phase: 'attack' }, 0, src, 'T-DULLCOST:act')).toMatch(/Main Phase/)
packages/engine/test/activated-abilities.test.ts:212:    expect(activationCheck({ ...s, turnPlayer: 1 }, 0, src, 'T-DULLCOST:act')).toMatch(/your own turn/)
packages/engine/test/activated-abilities.test.ts:224:    expect(activationCheck(s, 0, handId, 'T-HAND:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:225:    expect(activationCheck(s, 0, fieldId, 'T-FIELD:act')).toBeNull()
packages/engine/test/activated-abilities.test.ts:227:    expect(activationCheck(s, 0, strayField, 'T-HAND:act')).toMatch(/only be used from your hand/)
packages/engine/test/activated-abilities.test.ts:249:describe('activations are enumerated and labelled', () => {
packages/engine/test/activated-abilities.test.ts:250:  it('legalCommands offers one activation per clause, from every source zone', () => {
packages/engine/test/cr11.2-cp.test.ts:80:describe('C3: requiredElements — §11.2.1.1/§11.2.2 Light/Dark same-element exemption', () => {
apps/web/src/game/commands.ts:260:    // before clicking, not after (spec C3-A7).
apps/web/src/game/commands.ts:263:      const cost = activatedCostOf(v, c.source, c.abilityId)
apps/web/src/game/commands.ts:325:    // An activation is an action taken BY a card, so its subject is the source — clicking the card is how you
apps/web/src/game/commands.ts:401: * one entry per minimal payment. C3 added the second; collapsing only casts would have put a separate button
apps/web/src/game/commands.ts:466:  const ability = activatedAbilityOf(v, c.source, c.abilityId)
apps/web/src/game/commands.ts:467:  if (!ability || ability.trigger.kind !== 'activated') return null
apps/web/src/game/commands.ts:471:/** The activated clause `abilityId` names, read off the view's own definitions. */
apps/web/src/game/commands.ts:472:function activatedAbilityOf(v: PlayerView, source: CardId, abilityId: string): Ability | undefined {
apps/web/src/game/commands.ts:477:/** The printed cost of one activated clause, for the button label. */
apps/web/src/game/commands.ts:478:function activatedCostOf(v: PlayerView, source: CardId, abilityId: string): string {
apps/web/src/game/commands.ts:479:  const ability = activatedAbilityOf(v, source, abilityId)
apps/web/src/game/commands.ts:480:  return ability && ability.trigger.kind === 'activated' ? describeAbilityCost(ability.trigger.cost) : 'Ability'
apps/web/src/ui/Board.tsx:89:/** Targetable cards those zones do NOT draw — the Break Zone today, more hidden zones in C2/C3. */
apps/web/src/ui/Board.tsx:140:  // give it a row. That closes the class (C2/C3 target more hidden zones) instead of this one instance.
packages/engine/test/observer-triggers.test.ts:184:      // `reason` rides on the event from C3 so narration can tell a break from a cost payment.
docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:27:**C3 deck search cannot safely reuse the current target prompt representation.**
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:21:  actually built, and what C3 inherits" — it names the prerequisites this spec claims to answer.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:23:  "Design C3 deck choices as private/revealed information, not raw target IDs" item this spec is answering.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:30:  `search.ts` — for C3-4.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:39:1. **C3-1/C3-2, the knowledge representation.** Is `FieldView.deck: (CardId | null)[]` the right shape, or is
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:44:2. **C3-3, redaction.** Is redacting `pending.candidates` at `viewFor` sufficient, or does `Pending` leak
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:48:3. **C3-4, the ISMCTS keying.** Is "collapse a non-root player's private choice to an observable key" correct
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:52:4. **C3-6, the simplification.** Is fixing the bottoming order defensible, or does it interact with anything
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:56:   Is anything in C3-7 (Hugh Yurg, Cloud) actually cheaper than it looks and worth pulling in?
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:88:     1	# Rung C3 — Looking at your own deck: the information model, and the two cards that need it
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:90:     3	> Revision 1 (2026-08-27). Prerequisite reading: the "What C2 actually built, and what C3 inherits" section of
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:129:    42	| C3-1 | **Knowledge is per player, and lives in the view's deck** | `FieldView.deckCount: number` becomes `FieldView.deck: readonly (CardId \| null)[]` — one slot per card, non-null **only** where that viewer legitimately knows what is there. The count is `deck.length`, so nothing is lost. This is the minimal representation that can express "I know my top 3 but not my fourth", which is precisely what Reeve creates. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:130:    43	| C3-2 | **`determinise` pins what is known and samples the rest** | Non-null slots keep their id and code and are removed from the unseen multiset before shuffling, exactly as field and hand cards already are (`determinise.ts:38`). Everything else is sampled as today. Without this, an AI that looked at its own top 3 would re-randomise them the instant it tried to think about them — the search would be reasoning about a deck it had just been told it did not have. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:131:    44	| C3-3 | **`viewFor` redacts pending candidates the viewer cannot see** | A `chooseTargets` whose candidates include hidden cards is filtered to those visible **to that viewer**, and carries `hidden: number` for the remainder. The opponent of a Reeve therefore sees "choosing 1 of 3 cards" and no identities. Redaction happens at the view boundary, not at the prompt, because the view boundary is the only place that knows who is asking. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:132:    45	| C3-4 | **A private choice by the OPPONENT must key on what was observed, not on what was sampled** | In ISMCTS, an opponent's private deck choice is re-sampled every determinisation. Keyed by card identity, one real decision would shatter into dozens of tree nodes that the searcher can never tell apart in play — and each would be conditioned on information the searcher does not have. Action keys for a non-root player's private choice collapse to the observable form (`take 1 of N from deck`). This is the D2 review's warning that "Reeve's private look invalidates the search's assumption that every action becomes public", answered. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:133:    46	| C3-5 | **`reveal` and `look at` are one primitive with a visibility flag** | `lookAt { count, visibility: 'public' \| 'private', filter, take }`. Public grants the knowledge to both players, private only to the controller. Building these as two effects would duplicate the ordering, filtering and bottoming logic to express a difference of one field. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:134:    47	| C3-6 | **MVP0-SIMPLIFICATION: "in any order" becomes a fixed order** | The rest go to the bottom in their revealed order; the player is not asked to arrange them. Asking would add a permutation decision (4 cards = 24 orderings) to every Miner, for cards going to the **bottom of a 40+ card deck**, which in a game this length will almost never be drawn. Marked `MVP0-SIMPLIFICATION` at the site with this reasoning, and listed in the README's deviations. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:135:    48	| C3-7 | Not in scope | **Hugh Yurg** (searches the *whole* deck, and *plays* the card onto the field rather than taking it to hand — that needs a put-into-play-without-paying effect); **Cloud's Attack-Phase clause** (needs attack entry split into preparation + continuation); EX Burst; Sphene; the "in any order" prompt. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:152:    65	- **C3-A1** Miner's ETB reveals the top 5 publicly, adds a chosen **Backup** among them to hand, and bottoms
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:154:    67	- **C3-A2** Reeve's ETB shows the top 3 **to its controller only**, adds a chosen card to hand, bottoms the
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:157:    70	- **C3-A3 (the determinisation guard)** From a view in which the controller knows its top 3, `determinise`
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:160:    73	- **C3-A4 (no leak through the search)** Two determinisations of the same opponent-private choice produce the
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:162:    75	- **C3-A5** A deck with fewer cards than the reveal count reveals what is there and does not throw; an empty
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:164:    77	- **C3-A6** `ABILITY_CLAUSES` for both cards drops by one clause each, the amber "not implemented" warning
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:166:    79	- **C3-A7** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @fftcg/web build` green; fuzzer
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:212:    35	| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:273:    96	## What C2 actually built, and what C3 inherits (from the C2 code review)
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:275:    98	Recorded so C3 does not start from a false assumption, the way C2 nearly did:
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:281:   104	  has no observer source until it exists**, and that is a C3 clause. Build the transition-producing
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:357:    54	6. **Anything over-built or missing** for the next rung (C3 abilities: deck search/reveal, and Cloud's
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:593:   290	    43	| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:2175:  1872	-| D2-8 | Not in scope | Any change to the search itself, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:2185:  1882	+| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:3026:  2723	    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5653:  5350	/bin/zsh -lc "rg -n \"C3|deck search|reveal|Cloud|attack-phase|attack phase\" docs/superpowers packages apps -g '*.md' -g '*.ts' -g '*.tsx'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5655:  5352	docs/superpowers/specs/2026-08-27-rung-d2-search-worker.md:43:| D2-8 | Not in scope | Any change to the search, its keys or its evaluation; a worker pool or parallel search; C3's ability clauses. |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5660:  5357	packages/cards/src/abilities.ts:57: * itself is rung C3: this clause fires on a NORMAL cast, which is what `enterField` means. Noel's second
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5661:  5358	packages/cards/src/abilities.ts:58: * clause (the [Dull] action ability) is C3 and keeps warning — hence `ABILITY_CLAUSES['16-092C'] === 2`.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5666:  5363	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5667:  5364	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:96:## What C2 actually built, and what C3 inherits (from the C2 code review)
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5668:  5365	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:98:Recorded so C3 does not start from a false assumption, the way C2 nearly did:
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5670:  5367	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:104:  has no observer source until it exists**, and that is a C3 clause. Build the transition-producing
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5677:  5374	docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:25:**Fix:** Track coverage per ability clause, not per card code—e.g. stable `abilityId`s and `complete: boolean`. Remove the warning only for implemented clauses and continue warning that Noel’s action/EX, Lightning’s EX/second trigger, and Cloud’s deferred trigger are incomplete. If A2 genuinely means whole-card completion, C1 necessarily absorbs work currently assigned to C2/C3.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5682:  5379	docs/superpowers/plans/2026-08-27-rung-c1-abilities.codex-review.md:101:Class Tenth Moogle changes produced CP (`packages/cards/data/cards.json:29`), Odin has conditional cost reduction (`packages/cards/data/cards.json:60`), and Sphene has static Break Zone protection (`packages/cards/data/cards.json:257`). None fits the listed C1/C2/C3 groups cleanly.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5690:  5387	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:28:| Action abilities (`[Dull]:`, `[Earth], discard:`), costs, once-per-turn | Red Mage, Geomancer, Sphene, Miner | C3 |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5691:  5388	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:29:| EX Burst on damage | Odin, Noel, Reeve, Lightning | C3 |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5692:  5389	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:32:That last row was missing from revision 1 and has no home in C1–C3; it is now rung C4.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5696:  5393	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:48:| C1-11 | Not in scope | Everything in the C2/C3/C4 rows above, the stack and response windows, and Limit Break (skipped program-wide). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5698:  5395	docs/superpowers/specs/2026-08-27-rung-c1-abilities.md:105:- **Card set changed.** Lightning is out (its EX Burst and zone-change trigger belong to C2/C3); **Ramuh
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5700:  5397	docs/superpowers/specs/2026-08-26-heuristic-ai-design.md:38:- **A4**: the built signature is `preferredPayment(state, player, card)` — it operates on a full (determinised) `GameState`, not a bare `PlayerView`, because it needs backup/hand card definitions and `canPay`/`generateCp` from the engine. It also resolves multi-element costs via `requiredElements(def)` (§11.2.1.1 Light/Dark exemption, C3) and bounded backtracking over the required elements (C2, final fix wave) — not simply "dull backups then discard" in element order, and not a single scarcity-first greedy pass either: a single pass, even scarcest-element-first, can still strand a later element when the cheapest per-element pick spends a source only that element's rescue depended on (Codex's 3-element counterexample). Backtracking explores every source-to-element assignment and keeps the cheapest complete one.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5702:  5399	packages/cards/test/abilities.test.ts:94:  /** The EX BURST tag is C3; the trigger itself fires on a normal cast, which is what `enterField` means. */
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5703:  5400	packages/cards/test/abilities.test.ts:130:    // "[Dull], put Noel into the Break Zone: Dull all the Forwards opponent controls." is a C3 action ability.

exec
/bin/zsh -lc "nl -ba README.md | sed -n '1,80p'; rg -n \"sorcery|Main Phase|activated|combat trick|action abilities\" README.md docs -g '*.md' | head -160" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
     1	# fftcg-game
     2	
     3	A personal digital implementation of the *Final Fantasy Trading Card Game* (Square Enix):
     4	a rules engine plus a text hotseat CLI, built as a from-scratch exercise. Not affiliated
     5	with Square Enix.
     6	
     7	Design spec and MVP ladder:
     8	[`docs/superpowers/specs/2026-08-25-fftcg-game-design.md`](docs/superpowers/specs/2026-08-25-fftcg-game-design.md).
     9	
    10	## Status: rung D — playable in the browser against a search-based AI
    11	
    12	**You can sit down and play a full game against the AI in a browser**: first-player choice and
    13	mulligan, casting Backups/Forwards/Summons with CP paid for you, attacking and blocking, party
    14	damage, and win/loss. The engine (`packages/engine`) and the AI (`packages/ai`) contain no `node:`
    15	imports, so the whole game — rules, opponent, and card database — runs client-side. There is no
    16	server.
    17	
    18	The browser opponent is the **ISMCTS search**, running in a Web Worker so the board never freezes
    19	while it thinks (rung D2). It beats the heuristic agent **90.0 %** over 120 mirrored games. If the
    20	worker fails for any reason the game falls back to the heuristic agent permanently and says so in
    21	the log, in amber — a weaker opponent is never silent.
    22	
    23	Card abilities are **partly** implemented: **10 of the starter deck's 28 printed ability clauses,
    24	across 8 of its 19 cards**. Every unimplemented clause plays as if its text box were blank, and the
    25	game log says so in amber whenever such a card hits the field, so the caveat is visible in play
    26	rather than a silent surprise. Finishing them is rung C3.
    27	
    28	The same engine still plays in the terminal (hotseat) and under a self-play fuzzer.
    29	
    30	## Running it
    31	
    32	```sh
    33	pnpm install
    34	pnpm --filter @fftcg/web dev                           # play in a browser — open the URL it prints
    35	
    36	pnpm test                                              # vitest
    37	pnpm typecheck                                         # tsc -b, all packages
    38	pnpm lint                                               # eslint .
    39	
    40	pnpm --filter @fftcg/cli hotseat --seed 1                              # play a game in the terminal
    41	pnpm --filter @fftcg/cli selfplay --games 200 --seed 1                 # random-vs-random fuzzer
    42	pnpm --filter @fftcg/cli selfplay --games 200 --seed 1 --p0 greedy --p1 random --fast   # greedy AI vs random
    43	pnpm --filter @fftcg/cli mirror --pairs 60 --a ismcts --b greedy --fast                 # ISMCTS vs greedy, seats swapped
    44	pnpm --filter @fftcg/cli deckorder --seed 1                            # print a seeded deck order
    45	```
    46	
    47	`mirror` is the honest way to compare two agents: it plays every seed twice with the seats swapped,
    48	so a seat advantage cannot masquerade as a strength difference, and reports a **paired-bootstrap
    49	confidence interval** rather than a bare percentage.
    50	
    51	All three CLI commands accept `--seed N` and `--deck <path>` (default deck:
    52	`decks/starter-2025-vol2.txt`); `selfplay` also accepts:
    53	- `--games N` — number of games (default 200).
    54	- `--p0 <spec>`, `--p1 <spec>` — per-seat agent, one of `random` (default), `greedy`, `greedy:N`
    55	  (`N` = 0, 1, or 2; pins that seat's lookahead depth regardless of `--depth`), or `ismcts[:N]`
    56	  (`N` = iteration budget; bare `ismcts` uses the search's own default, so a run is always reported
    57	  with the budget that produced its ms/decision).
    58	- `--depth N` — lookahead depth (0, 1, or 2; default 1) applied to any `greedy` seat that didn't pin
    59	  its own depth via `greedy:N`.
    60	- `--fast` — skips the engine's `checkInvariants`/immutability assertions between commands (`strict:
    61	  false`), which meaningfully speeds up large tournaments; use the default (strict) mode when
    62	  debugging engine behaviour, `--fast` for win-rate measurement runs.
    63	
    64	## Card data
    65	
    66	`packages/cards/data/cards.json` is a generated snapshot, not hand-maintained. Regenerate
    67	it with:
    68	
    69	```sh
    70	pnpm --filter @fftcg/cards run fetch
    71	```
    72	
    73	(`pnpm fetch` collides with pnpm's own built-in `fetch` command — the `run` is required.)
    74	
    75	This POSTs to Square Enix's public `get-cards` endpoint and keeps only the cards referenced
    76	by files in `decks/`. The Vol. 2 starter-exclusive cards (`27-1xxS`) aren't in that
    77	endpoint's data, so they're hand-transcribed from the physical cards into
    78	`packages/cards/data/patches/starter-2025-vol2-exclusives.json`, which takes priority over
    79	the fetched data for any overlapping code. Card images are never fetched or committed.
    80	Card text and imagery are © Square Enix; this repo uses them only for personal, non-commercial
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:37:activated abilities — Red Mage's `[Lightning][Dull]`, Noel's `[Dull], put into the Break Zone`, Miner's
docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md:43:Eight clauses behind one primitive beats two clauses behind four blockers, and activated abilities are also
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:5:> `docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md`. This rung replaced a
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:27:**This is the rung a human notices.** Ten triggered clauses make a board that happens to you; activated
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:53:| C3-10 | **The AI must be given activations explicitly** | Revision 1 said the AI gets them "for free" from `legalCommands`. It does not: `candidateCommands` hand-builds casts and `pass` in the Main Phases (`candidates.ts:295`) and the search enumerates *that* list. Activation needs its own emission (one preferred-payment activation per `(source, abilityId, target set)`), plus `ActionKey` encode/decode and the synthetic-id guard. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:54:| C3-11 | **MVP0-SIMPLIFICATION: turn player, Main Phase 1 or 2 only — and this one costs something** | Revision 1 claimed this was "not a further loss of fidelity". Wrong: the CR allows action abilities in the Attack Phase too, and the engine even has an unblocked turn-player action point at attack declaration (`legal.ts:68`). Noel and Red Mage still work from Main 1 before attacking, but **Undead Princess stops being a combat trick** — she cannot pump after blockers are declared. Stated plainly as "action abilities are sorcery-speed", marked at the site, and listed in the README's deviations. |
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:101:  illegal outside the turn player's Main Phases. Rare positions (fresh Noel with Haste, no legal non-source
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:108:  cost, with payment variants collapsed to one button; narration says the ability was **activated**, not
docs/superpowers/specs/2026-08-25-fftcg-game-design.md:75:- Ability = trigger (`onEnterField`, `onAttack`, `activated`, `static`, `exBurst`, …) + a
docs/superpowers/specs/2026-08-25-fftcg-game-design.md:103:| **MVP3** | Abilities I | Generator ability system + primitives; first ~third of Vol. 2 cards scripted (ETB damage, activated abilities, EX Burst, simple statics). Coverage script. | 4–5 |
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:212:    35	| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:289:   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:291:   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:2951:  2648	    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:3026:  2723	    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5666:  5363	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5673:  5370	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5674:  5371	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5733:  5430	docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5795:  5492	   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5797:  5494	   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:5842:  5539	    35	Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:6085:  5782	    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:6092:  5789	    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:6897:  6594	     7	  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:6898:  6595	     8	  attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:7040:  6737	   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:7041:  6738	   289	    case 'main2': return 'Main Phase 2 — cast or pass'
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:7231:  6928	   136	    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:7649:112-- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:7651:114-  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:10079:    28	 * one plus an activated one (Odin, Sphene) count both.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:10500:packages/engine/src/phases.ts:32:  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:10784:packages/engine/test/cr9-phases.test.ts:14:    expect(events).toContainEqual({ type: 'activated', player: 0, cards: [a] })
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11069:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11073:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11074:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11093:docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11115:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11118:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5370:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11119:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5371:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11163:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5430:docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11189:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5492:   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11190:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5494:   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11194:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5539:    35	Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:11297:136-    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:12150:    10	  | { type: 'activated'; player: PlayerId; cards: CardId[] }
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:12289:    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:12364:    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:12525:    11	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:12816:   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:12817:   289	    case 'main2': return 'Main Phase 2 — cast or pass'
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:13185:    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:13192:    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:13556:apps/cli/src/render.ts:3:const PHASE_LABEL: Record<string, string> = { setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase' }
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:13692:apps/web/src/ui/PromptStrip.tsx:7:  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:13929:    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:13936:    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:14826:docs/superpowers/specs/2026-08-25-fftcg-game-design.md:103:| **MVP3** | Abilities I | Generator ability system + primitives; first ~third of Vol. 2 cards scripted (ETB damage, activated abilities, EX Burst, simple statics). Coverage script. | 4–5 |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:14829:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:14856:docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md:14862:docs/superpowers/plans/2026-08-25-mvp0-bones.md:43:- Deliberate MVP0 simplifications (each must be marked with a `// MVP0-SIMPLIFICATION:` comment where it lives, so later rungs can grep them): no stack, no priority passing (the non-turn player never holds priority), Summons may only be cast in Main Phases (§9.3.1.6 also allows the Attack Phase; those windows arrive with the stack), mulligan puts the hand back in hand order rather than a chosen order (§8.2.1.4), Attack Preparation and Damage Resolution steps auto-advance, Summons resolve to no effect, EX Burst on a damage-zone card is logged not resolved, a 6th Backup is simply illegal to cast (§7.7.4 first sentence) rather than handled by rule process §12.4.8, Light/Dark rules unimplemented (pool has none). Multi-Element cards (Shantotto 12-120C, Billy Bob 18-124C are Earth/Lightning) ARE in scope: casting them requires ≥1 CP of each element (§11.2.2.1).
docs/superpowers/plans/2026-08-25-mvp0-bones.codex-review.md:19:- **Task 7, `castCheck` — Concern:** Summons are incorrectly limited to Main Phases. CR §9.3.1.6 permits Summons during Main and Attack Phases, while the shared check rejects every Attack Phase cast. **Change:** Give Summons their own timing check and model the required Attack Phase action windows, or declare this broader restriction explicitly as an MVP0 simplification.
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:2648:    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:2723:    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5370:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5371:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5430:docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5492:   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5494:   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5539:    35	Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5782:    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5789:    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:6594:     7	  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:6595:     8	  attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:6737:   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:6738:   289	    case 'main2': return 'Main Phase 2 — cast or pass'
docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:6928:   136	    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-25-mvp0-bones.md:43:- Deliberate MVP0 simplifications (each must be marked with a `// MVP0-SIMPLIFICATION:` comment where it lives, so later rungs can grep them): no stack, no priority passing (the non-turn player never holds priority), Summons may only be cast in Main Phases (§9.3.1.6 also allows the Attack Phase; those windows arrive with the stack), mulligan puts the hand back in hand order rather than a chosen order (§8.2.1.4), Attack Preparation and Damage Resolution steps auto-advance, Summons resolve to no effect, EX Burst on a damage-zone card is logged not resolved, a 6th Backup is simply illegal to cast (§7.7.4 first sentence) rather than handled by rule process §12.4.8, Light/Dark rules unimplemented (pool has none). Multi-Element cards (Shantotto 12-120C, Billy Bob 18-124C are Earth/Lightning) ARE in scope: casting them requires ≥1 CP of each element (§11.2.2.1).
docs/superpowers/plans/2026-08-25-mvp0-bones.md:330:  | { type: 'activated'; player: PlayerId; cards: CardId[] }
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1230://   attack/declaration → main2 (§10.1.4.6 "otherwise proceed to Main Phase 2")
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1317:    expect(events).toContainEqual({ type: 'activated', player: 0, cards: [a] })
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1476:  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-25-mvp0-bones.md:1483:  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-25-mvp0-bones.md:2942:    expect(text).toMatch(/Turn 1/); expect(text).toMatch(/Main Phase 1/); expect(text).toMatch(/Hand \(6\)/)
docs/superpowers/plans/2026-08-25-mvp0-bones.md:2993:const PHASE_LABEL: Record<string, string> = { setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase' }
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:19:- `docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md` — the spec under review.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:59:   including the Haste exception? Is restricting activation to the turn player's Main Phases 1 and 2
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:82:/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md' -g 'docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md' -g 'docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md' -g 'docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md' -g 'packages/engine/src/*.ts' -g 'packages/cards/src/abilities.ts' -g 'packages/ai/src/*.ts' -g 'apps/web/src/game/commands.ts' -g 'apps/web/src/ui/Board.tsx'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:117:docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:121:/bin/zsh -lc "nl -ba docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md && nl -ba docs/superpowers/specs/2026-08-27-rung-c6-deck-knowledge.md | sed -n '1,180p' && nl -ba docs/superpowers/plans/2026-08-27-rung-c3-deck-knowledge.codex-review.md" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:153:    31	**This is the rung a human notices.** Ten triggered clauses make a board that happens to you; activated
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:175:    53	| C3-1 | **One new command: `activateAbility { player, card, clause, payment }`** | `clause` indexes into the card's ability list, so a card with two activated abilities is unambiguous. `payment` is the **existing** `Payment`, validated by the **existing** CP machinery — an activated ability's CP cost is not a different kind of cost from a cast's, and giving it its own path would be the beginning of two payment systems. |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:179:    57	| C3-5 | **MVP0-SIMPLIFICATION: activation is restricted to the turn player during Main Phase 1 or 2** | The real rules let action abilities be used whenever a player has priority. MVP0 has no stack and `priority` is always the turn player (`state.ts:47`), so there is no window in which a non-turn player could act anyway. Restricting to the Main Phases is therefore not a further loss of fidelity — it is the honest statement of what the existing priority model can already express. Marked at the site, and listed in the README's deviations. |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:210:    88	  activating player's Main Phase. Each is a separate test, and each asserts the command is absent from
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:264:    37	activated abilities — Red Mage's `[Lightning][Dull]`, Noel's `[Dull], put into the Break Zone`, Miner's
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:270:    43	Eight clauses behind one primitive beats two clauses behind four blockers, and activated abilities are also
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:577:   212	    35	| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:654:   289	   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:656:   291	   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:3316:  2951	  2648	    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:3391:  3026	  2723	    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6031:  5666	  5363	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6038:  5673	  5370	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6039:  5674	  5371	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6098:  5733	  5430	docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6160:  5795	  5492	   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6162:  5797	  5494	   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6207:  5842	  5539	    35	Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6450:  6085	  5782	    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:6457:  6092	  5789	    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:7066: 10079	    28	 * one plus an activated one (Odin, Sphene) count both.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:7487: 10500	packages/engine/src/phases.ts:32:  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:7771: 10784	packages/engine/test/cr9-phases.test.ts:14:    expect(events).toContainEqual({ type: 'activated', player: 0, cards: [a] })
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8056: 11069	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8060: 11073	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8061: 11074	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8080: 11093	docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8102: 11115	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8105: 11118	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5370:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:112:- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8106: 11119	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5371:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:114:  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8150: 11163	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5430:docs/superpowers/plans/2026-08-27-rung-c2-observer-triggers.codex-code-review.md:35:Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8176: 11189	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5492:   112	- **The continuation slot alone cannot carry Cloud's Attack-Phase clause.** Passing Main Phase 1 enters
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8177: 11190	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5494:   114	  so queueing Cloud before it would resolve the clause while the state still says Main Phase 1. Attack
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8181: 11194	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5539:    35	Passing Main Phase 1 immediately enters attack declaration at [phases.ts:50](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/phases.ts:50), and `enterAttackDeclaration` emits both preparation and declaration events together at [resolve.ts:386](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:386). Simply queueing Cloud before the existing continuation would resolve it while the state still says Main Phase 1.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:8284: 11297	136-    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:9137: 12150	    10	  | { type: 'activated'; player: PlayerId; cards: CardId[] }
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:9276: 12289	    17	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:9351: 12364	    92	    // `cast`/`attackDeclared`/`blockDeclared`/`cpGenerated` restate the move line; `activated` and
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:9512: 12525	    11	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:9803: 12816	   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:9804: 12817	   289	    case 'main2': return 'Main Phase 2 — cast or pass'
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:10172: 13185	    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:10179: 13192	    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:10543: 13556	apps/cli/src/render.ts:3:const PHASE_LABEL: Record<string, string> = { setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase' }
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:10679: 13692	apps/web/src/ui/PromptStrip.tsx:7:  setup: 'Setup', active: 'Active Phase', draw: 'Draw Phase', main1: 'Main Phase 1',
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:10916: 13929	    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:10923: 13936	    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:11813: 14826	docs/superpowers/specs/2026-08-25-fftcg-game-design.md:103:| **MVP3** | Abilities I | Generator ability system + primitives; first ~third of Vol. 2 cards scripted (ETB damage, activated abilities, EX Burst, simple statics). Coverage script. | 4–5 |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:11816: 14829	docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:11843: 14856	docs/superpowers/plans/2026-08-27-rung-d2-search-worker.codex-code-review.md:5363:docs/superpowers/specs/2026-08-27-rung-c2-observer-triggers.md:35:| C2-13 | Not in scope | Prishe c1 ("when chosen by a Summon or an ability" — needs the agenda to **preempt an active frame**, which it cannot do; targets are chosen while a frame is already executing), Hugh Yurg / Miner / Reeve (deck search → C3), Cloud's Attack-Phase clause (C3), action abilities and EX Burst (C4), static/cost modification (C5). |
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:11849: 14862	docs/superpowers/plans/2026-08-25-mvp0-bones.md:43:- Deliberate MVP0 simplifications (each must be marked with a `// MVP0-SIMPLIFICATION:` comment where it lives, so later rungs can grep them): no stack, no priority passing (the non-turn player never holds priority), Summons may only be cast in Main Phases (§9.3.1.6 also allows the Attack Phase; those windows arrive with the stack), mulligan puts the hand back in hand order rather than a chosen order (§8.2.1.4), Attack Preparation and Damage Resolution steps auto-advance, Summons resolve to no effect, EX Burst on a damage-zone card is logged not resolved, a 6th Backup is simply illegal to cast (§7.7.4 first sentence) rather than handled by rule process §12.4.8, Light/Dark rules unimplemented (pool has none). Multi-Element cards (Shantotto 12-120C, Billy Bob 18-124C are Earth/Lightning) ARE in scope: casting them requires ≥1 CP of each element (§11.2.2.1).
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:13766:    32	  if (dulled.length) events.push({ type: 'activated', player, cards: dulled })
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:13773:    39	  // §9.3 Main Phase 1
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:13952:    10	  | { type: 'activated'; player: PlayerId; cards: CardId[] }
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:15632:    28	 * one plus an activated one (Odin, Sphene) count both.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:15955:packages/cards/data/cards.json:136:    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:15965:packages/cards/src/abilities.ts:28: * one plus an activated one (Odin, Sphene) count both.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:15985:packages/cards/src/abilities.ts:28: * one plus an activated one (Odin, Sphene) count both.
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:16016:packages/cards/data/cards.json:136:    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:16189:   136	    "text": "Put Undead Princess into the Break Zone: Choose 1 Forward. It gains +4000 power until the end of the turn.\nRemove Undead Princess in the Break Zone from the game: Choose 1 Earth Forward. It gains +2000 power until the end of the turn. You can only use this ability during your Main Phase and if Undead Princess is in the Break Zone.",
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:17077:    11	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:17354:   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:17355:   289	    case 'main2': return 'Main Phase 2 — cast or pass'
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:18259:    11	  main1: 'Main Phase 1', attack: 'Attack Phase', main2: 'Main Phase 2', end: 'End Phase',
docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:18536:   288	    case 'main1': return 'Main Phase 1 — cast, attack, or pass'

codex
The core cost transaction itself is otherwise ordered correctly: validation happens before mutation, cost-zone observers are queued before the action frame, FIFO plus `settle` preserves that order across prompts, and frames resolve by global card identity so a source leaving the field is safe. The remaining checks are CP minimality/membership, log semantics, and acceptance-test coverage.
exec
/bin/zsh -lc 'pnpm exec vitest run packages/engine/test/activated-abilities.test.ts packages/engine/test/cr11.2-cp.test.ts packages/ai/test/payment.test.ts apps/web/test/commands.test.ts --no-file-parallelism' in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 exited 1 in 283ms:
failed to load config from /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/vitest.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error: EPERM: operation not permitted, open '/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.vite-temp/vitest.config.ts.timestamp-1787822881499-3f02b92c251928.mjs'
    at async open (node:internal/fs/promises:1360:25)
    at async Object.writeFile (node:internal/fs/promises:2104:14)
    at async loadConfigFromBundledFile (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vite@7.3.6_@types+node@24.13.3_tsx@4.23.12/node_modules/vite/dist/node/chunks/config.js:35994:3)
    at async bundleAndLoadConfigFile (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vite@7.3.6_@types+node@24.13.3_tsx@4.23.12/node_modules/vite/dist/node/chunks/config.js:35884:17)
    at async loadConfigFromFile (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vite@7.3.6_@types+node@24.13.3_tsx@4.23.12/node_modules/vite/dist/node/chunks/config.js:35851:42)
    at async resolveConfig (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vite@7.3.6_@types+node@24.13.3_tsx@4.23.12/node_modules/vite/dist/node/chunks/config.js:35500:22)
    at async _createServer (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vite@7.3.6_@types+node@24.13.3_tsx@4.23.12/node_modules/vite/dist/node/chunks/config.js:25441:67)
    at async createViteServer (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vitest@3.2.7_@types+node@24.13.3_supports-color@7.2.0_tsx@4.23.12/node_modules/vitest/dist/chunks/cli-api.DVe0nWUx.js:6921:17)
    at async createVitest (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vitest@3.2.7_@types+node@24.13.3_supports-color@7.2.0_tsx@4.23.12/node_modules/vitest/dist/chunks/cli-api.DVe0nWUx.js:10212:17)
    at async prepareVitest (file:///Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.pnpm/vitest@3.2.7_@types+node@24.13.3_supports-color@7.2.0_tsx@4.23.12/node_modules/vitest/dist/chunks/cli-api.DVe0nWUx.js:10551:14) {
  errno: -1,
  code: 'EPERM',
  syscall: 'open',
  path: '/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/node_modules/.vite-temp/vitest.config.ts.timestamp-1787822881499-3f02b92c251928.mjs'
}




exec
/bin/zsh -lc "nl -ba apps/web/test/commands.test.ts | sed -n '453,530p'; nl -ba apps/web/test/useGame.test.ts | tail -120; nl -ba apps/cli/test/agents.test.ts | sed -n '111,150p'; git show --stat --oneline 70707c0 dadf42b 56151cb eee7eab" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   453	describe('activated abilities on the board (C3-A7)', () => {
   454	  /** A board with one Red Mage on the field, plus an unrelated Backup that could pay for its ability. */
   455	  function redMageView(): { v: PlayerView; src: CardId; backup: CardId } {
   456	    const v = viewFor(dealtGame(1), HUMAN)
   457	    const src = instance(v, 910, '1-121C')
   458	    const backup = instance(v, 911, '9-074C')
   459	    v.fields[HUMAN].backups = [fieldCard(src), fieldCard(backup)]
   460	    return { v, src, backup }
   461	  }
   462	  const act = (source: CardId, abilityId: string, payment: Payment = { dullBackups: [], discards: [] }): Command =>
   463	    ({ type: 'activateAbility', player: HUMAN, source, abilityId, payment })
   464	
   465	  it('belongs to its source card, so the board lights that card up', () => {
   466	    // Not the CP sources: those are payment, chosen for the player, and making them clickable would imply
   467	    // the click picks them.
   468	    const { v, src, backup } = redMageView()
   469	    const set = buildChoiceSet(v, [act(src, '1-121C:haste', { dullBackups: [backup], discards: [] })])
   470	    expect(set.byCard.get(src)?.map((c) => c.command.type)).toEqual(['activateAbility'])
   471	    expect(set.byCard.get(backup)).toBeUndefined()
   472	  })
   473	
   474	  it('labels the button with the printed cost', () => {
   475	    const { v, src, backup } = redMageView()
   476	    const label = describeChoice(v, act(src, '1-121C:haste', { dullBackups: [backup], discards: [] }))
   477	    expect(label).toContain('[Lightning][Dull]')
   478	  })
   479	
   480	  it('tells two clauses of the SAME card apart', () => {
   481	    // Miner and Undead Princess each print two clauses, so identity has to include the clause — the same
   482	    // reason the command carries `abilityId` rather than an index into the card's ability array.
   483	    const { src } = redMageView()
   484	    expect(sameCommand(act(src, '16-092C:etb'), act(src, '16-092C:dull-all'))).toBe(false)
   485	    expect(sameCommand(act(src, '16-092C:etb'), act(src, '16-092C:etb'))).toBe(true)
   486	  })
   487	
   488	  it('tells two payments of the same clause apart', () => {
   489	    const { src } = redMageView()
   490	    const a = act(src, '1-121C:haste', { dullBackups: [7], discards: [] })
   491	    const b = act(src, '1-121C:haste', { dullBackups: [8], discards: [] })
   492	    expect(sameCommand(a, b)).toBe(false)
   493	    expect(sameCommand(a, act(src, '1-121C:haste', { dullBackups: [7], discards: [] }))).toBe(true)
   494	  })
   495	})
   805	function aiHarness(seed: number, factory?: SearchTransportFactory): AiHarness {
   806	  const clock = new TestClock()
   807	  const transports: TestTransport[] = []
   808	  const lines: LogLine[] = []
   809	  const commits: GameState[] = []
   810	  let current = aiToAct(seed)
   811	  const sink: AiSink = {
   812	    commit: (next, produced) => { current = next; commits.push(next); lines.push(...produced) },
   813	    log: (line) => { lines.push(line) },
   814	  }
   815	  const createTransport: SearchTransportFactory = factory ?? ((h) => {
   816	    const t = new TestTransport(h)
   817	    transports.push(t)
   818	    return t
   819	  })
   820	  return {
   821	    clock, transports, lines, commits,
   822	    handlers: aiHandlers(sink),
   823	    search: createAiSearch(() => current, seed, { clock, createTransport }),
   824	    state: () => current,
   825	    setState: (next) => { current = next },
   826	    fallbacks: () => lines.filter((l) => l.kind === 'warning' && l.text.includes(FALLBACK_WARNING)),
   827	  }
   828	}
   829	
   830	describe('the hook drives the search worker (rung D2)', () => {
   831	  it('narrates and commits a delivered result on the pacing deadline (D2-5)', () => {
   832	    const h = aiHarness(11)
   833	    const before = h.state()
   834	    h.search.request(before, h.handlers)
   835	    const transport = h.transports[0]!
   836	    h.clock.advance(50)
   837	    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId))
   838	    expect(h.commits).toHaveLength(0)   // the search was fast; the board is still showing 600 ms of thinking
   839	    h.clock.advance(AI_STEP_MS - 50)
   840	    expect(h.commits).toHaveLength(1)
   841	    expect(h.state()).not.toBe(before)
   842	    expect(h.lines[0]?.kind).toBe('ai')
   843	    expect(h.lines[0]?.text.length).toBeGreaterThan(0)
   844	  })
   845	
   846	  it('surfaces the fallback as exactly one warning and keeps playing (D2-6)', () => {
   847	    const h = aiHarness(11, () => { throw new Error('this browser does not support Web Workers') })
   848	    h.search.request(h.state(), h.handlers)
   849	    h.clock.advance(AI_STEP_MS)
   850	    expect(h.fallbacks()).toHaveLength(1)
   851	    expect(h.fallbacks()[0]!.text).toContain('this browser does not support Web Workers')
   852	    expect(h.commits).toHaveLength(1)   // a warning, not a stop: Greedy played on the same deadline
   853	    for (let i = 0; i < 6 && actingPlayer(h.state()) === AI; i++) {
   854	      h.search.request(h.state(), h.handlers)
   855	      h.clock.advance(AI_STEP_MS)
   856	    }
   857	    expect(h.commits.length).toBeGreaterThan(1)
   858	    expect(h.fallbacks()).toHaveLength(1)
   859	  })
   860	
   861	  it('does not apply an in-flight result once the game has restarted (D2-4)', () => {
   862	    const h = aiHarness(11)
   863	    const stale = h.state()
   864	    h.search.request(stale, h.handlers)
   865	    const transport = h.transports[0]!
   866	    const inFlight = transport.searches[0]!.requestId
   867	    h.search.restart(99)
   868	    h.setState(aiToAct(99))
   869	    transport.handlers.message(resultMessage(stale, inFlight))
   870	    h.clock.advance(10 * AI_STEP_MS)
   871	    expect(h.commits).toHaveLength(0)
   872	    expect(h.lines).toHaveLength(0)
   873	    expect(transport.terminations).toBe(1)
   874	  })
   875	
   876	  it('restarts the decision index the search seed comes from (D2-3)', () => {
   877	    const h = aiHarness(11)
   878	    const first = h.state()
   879	    h.search.request(first, h.handlers)
   880	    const transport = h.transports[0]!
   881	    transport.handlers.message(resultMessage(first, transport.searches[0]!.requestId))
   882	    h.clock.advance(AI_STEP_MS)
   883	    expect(h.commits).toHaveLength(1)
   884	    h.search.request(h.state(), h.handlers)
   885	    expect(transport.searches[0]!.seed).toBe(searchSeed(11, 0))
   886	    expect(transport.searches[1]!.seed).toBe(searchSeed(11, 1))
   887	    h.search.restart(99)
   888	    h.setState(aiToAct(99))
   889	    h.search.request(h.state(), h.handlers)
   890	    expect(h.transports[1]!.searches[0]!.seed).toBe(searchSeed(99, 0))
   891	  })
   892	
   893	  it('refuses a command that is not legal in the state it was chosen for (B-A4)', () => {
   894	    const h = aiHarness(11)
   895	    const before = h.state()
   896	    h.search.request(before, h.handlers)
   897	    const transport = h.transports[0]!
   898	    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId, { type: 'concede', player: HUMAN }))
   899	    h.clock.advance(AI_STEP_MS)
   900	    // B-A4's guarantee is that the ILLEGAL command never commits — and it does not: the concede the worker
   901	    // sent would have ended the game, and the game is not over.
   902	    expect(h.state().result).toBeNull()
   903	    expect(h.lines.some((l) => l.kind === 'warning' && l.text.includes('not legal'))).toBe(true)
   904	    // But refusing it is only half the job. Before, refusal ended the turn: no move was scheduled and the
   905	    // state never changed, so the state-keyed effect never re-requested and the AI sat there forever. The
   906	    // refusal must now be recovered from, so the game still moves.
   907	    expect(h.commits).toHaveLength(1)
   908	    expect(h.state()).not.toBe(before)
   909	  })
   910	
   911	  it('drops the outstanding request when a human commit lands mid-search (D2-4)', () => {
   912	    const h = aiHarness(11)
   913	    const before = h.state()
   914	    h.search.request(before, h.handlers)
   915	    const transport = h.transports[0]!
   916	    // What `choose` does: invalidate, then apply. Concede is legal off-turn, so this really can happen.
   917	    h.search.invalidate()
   918	    h.setState(apply(before, { type: 'concede', player: HUMAN }).state)
   919	    transport.handlers.message(resultMessage(before, transport.searches[0]!.requestId))
   920	    h.clock.advance(10 * AI_STEP_MS)
   921	    expect(h.commits).toHaveLength(0)
   922	    expect(h.lines).toHaveLength(0)
   923	  })
   924	})
   111	// ---------------------------------------------------------------------------
   112	// Rung C3 — the agents must actually USE activated abilities
   113	// ---------------------------------------------------------------------------
   114	
   115	describe('activated abilities reach the agents (C3-A1)', () => {
   116	  // Being legal is not enough. `candidateCommands` hand-builds the list both agents search, so a command that
   117	  // exists only in `legalCommands` is invisible to them — the plan review caught exactly that, and this is the
   118	  // test that would have failed. It asserts the agents CHOOSE an activation over a real sweep, not merely that
   119	  // one was offered.
   120	  const chosen = new Map<string, number>()
   121	  for (let seed = 1; seed <= 40 && chosen.size === 0; seed++) {
   122	    const d = decks()
   123	    const defs = loadCards()
   124	    const agents: [Agent, Agent] = [
   125	      new GreedyAgent({ seed, decks: d, depth: 1 }),
   126	      new GreedyAgent({ seed: seed + 1000, decks: d, depth: 1 }),
   127	    ]
   128	    let s = createGame({ seed, decks: d, defs })
   129	    for (let i = 0; i < 800 && !s.result; i++) {
   130	      const p = actingPlayer(s)
   131	      if (p === null) break
   132	      const command = agents[p].decide(viewFor(s, p), legalCommands(s, p))
   133	      if (command.type === 'activateAbility') chosen.set(command.abilityId, (chosen.get(command.abilityId) ?? 0) + 1)
   134	      s = apply(s, command).state
   135	    }
   136	  }
   137	
   138	  it('greedy chooses an activation at least once across the sweep', () => {
   139	    expect(chosen.size, 'no agent ever used an activated ability — they are legal but unreachable').toBeGreaterThan(0)
   140	  })
   141	
   142	  it('every activation it chose is one of the six C3 clauses', () => {
   143	    const C3 = ['1-121C:haste', '16-092C:dull-all', '18-064C:draw', '18-069C:draw', '19-052C:pump', '20-074C:draw']
   144	    for (const id of chosen.keys()) expect(C3).toContain(id)
   145	  })
   146	})
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-csl2LnYX' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-xohmyNkG' (errno=Operation not permitted)
70707c0 feat(engine): rung C3 stage 1 — the activated-ability substrate
 apps/cli/src/render.ts           |  13 +++
 apps/web/src/game/commands.ts    |  23 ++++-
 packages/ai/src/greedy.ts        |   2 +
 packages/ai/src/ismcts/agent.ts  |   1 +
 packages/ai/src/ismcts/keys.ts   |  22 +++++
 packages/engine/src/abilities.ts |  62 +++++++++++++
 packages/engine/src/activate.ts  | 187 +++++++++++++++++++++++++++++++++++++++
 packages/engine/src/apply.ts     |   3 +
 packages/engine/src/commands.ts  |  17 ++++
 packages/engine/src/cp.ts        |  60 ++++++++++---
 packages/engine/src/draw.ts      |  27 ++++++
 packages/engine/src/events.ts    |   7 ++
 packages/engine/src/legal.ts     |  28 +++++-
 packages/engine/src/phases.ts    |  13 +--
 packages/engine/src/resolve.ts   |  10 ++-
 packages/engine/src/rules.ts     |  12 ++-
 16 files changed, 460 insertions(+), 27 deletions(-)
dadf42b feat(cards): rung C3 stage 2 — six activated clauses, and the AI actually uses them
 apps/cli/test/agents.test.ts                     |  42 ++++
 apps/web/test/useGame.test.ts                    |  23 +-
 packages/ai/src/candidates.ts                    |  31 ++-
 packages/ai/src/payment.ts                       |  32 ++-
 packages/cards/src/abilities.ts                  | 112 +++++++++-
 packages/cards/test/abilities.test.ts            |  38 +++-
 packages/engine/src/abilities.ts                 |  17 +-
 packages/engine/src/index.ts                     |   4 +-
 packages/engine/test/activated-abilities.test.ts | 267 +++++++++++++++++++++++
 9 files changed, 531 insertions(+), 35 deletions(-)
56151cb feat(web): rung C3 stage 3 — activations are usable, and narrated as activations
 apps/web/src/game/commands.ts                  | 77 +++++++++++++++++++-------
 apps/web/src/game/useGame.ts                   | 19 +++++--
 apps/web/test/commands.test.ts                 | 62 ++++++++++++++++++---
 apps/web/test/useGame.test.ts                  |  2 +-
 packages/ai/test/ismcts-keys.test.ts           |  4 +-
 packages/engine/src/abilities.ts               | 10 +++-
 packages/engine/src/resolve.ts                 |  2 +-
 packages/engine/src/rules.ts                   |  3 +-
 packages/engine/test/observer-triggers.test.ts |  5 +-
 9 files changed, 145 insertions(+), 39 deletions(-)
eee7eab fix(ai): power that expires is not worth the same as power a card has
 apps/cli/src/weights-ab.ts      | 59 +++++++++++++++++++++++++++++++++++++++++
 packages/ai/src/evaluate.ts     | 23 ++++++++++++++--
 packages/ai/test/greedy.test.ts | 51 +++++++++++++++++++++++++++++++++--
 3 files changed, 129 insertions(+), 4 deletions(-)

exec
/bin/zsh -lc "nl -ba apps/web/test/commands.test.ts | sed -n '130,190p'; rg -n \"preferredChoices|payment variants|collapse\" apps/web/test/commands.test.ts" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   130	      if (view.phase === 'main1' && actingPlayer(state) === HUMAN) break
   131	      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
   132	      state = apply(state, legalCommands(state, HUMAN).find((c) => c.type !== 'concede')!).state
   133	    }
   134	    expect([...seen]).toContain('Main Phase 1 — cast, attack, or pass')
   135	    expect([...seen].some((p) => p === 'Choose who goes first' || p === 'Keep your hand or mulligan' || p === 'Waiting for the opponent…')).toBe(true)
   136	  })
   137	})
   138	
   139	describe('preferredChoices', () => {
   140	  const { state, view, legal, card } = findMultiPaymentPosition(11)
   141	
   142	  it('collapses one card with many payments to exactly one choice', () => {
   143	    expect(legal.filter((c) => isCastFor(c, card)).length).toBeGreaterThan(1)
   144	    expect(preferredChoices(view, legal).filter((c) => isCastFor(c, card))).toHaveLength(1)
   145	  })
   146	
   147	  it('keeps the payment preferredPayment would pick', () => {
   148	    const kept = preferredChoices(view, legal).find((c) => isCastFor(c, card))
   149	    expect(kept?.type === 'castCharacter' || kept?.type === 'castSummon').toBe(true)
   150	    const preferred = preferredPayment(state, HUMAN, card)!
   151	    expect(samePayment((kept as Extract<Command, { type: 'castCharacter' }>).payment, preferred)).toBe(true)
   152	  })
   153	
   154	  it('leaves commands that carry no payment untouched and preserves relative order', () => {
   155	    const collapsed = preferredChoices(view, legal)
   156	    // C3 generalised the collapsing from casts to every command that carries a `Payment`, because
   157	    // `legalCommands` explodes activations into one entry per minimal payment exactly as it does casts —
   158	    // otherwise the board grows a separate button for each way of paying for the same Red Mage ability.
   159	    const PAYABLE = ['castCharacter', 'castSummon', 'activateAbility']
   160	    const unpayable = (cs: Command[]) => cs.filter((c) => !PAYABLE.includes(c.type))
   161	    expect(unpayable(collapsed)).toEqual(unpayable(legal))
   162	    // one entry per castable card, each sitting where that card's FIRST payment was
   163	    const order = collapsed.filter((c) => c.type === 'castCharacter' || c.type === 'castSummon').map((c) => (c as Extract<Command, { type: 'castCharacter' }>).card)
   164	    const firstSeen: CardId[] = []
   165	    for (const c of legal) if ((c.type === 'castCharacter' || c.type === 'castSummon') && !firstSeen.includes(c.card)) firstSeen.push(c.card)
   166	    expect(order).toEqual(firstSeen)
   167	  })
   168	
   169	  it('is a no-op when there is nothing to cast', () => {
   170	    const nothing: Command[] = [{ type: 'concede', player: HUMAN }, { type: 'pass', player: HUMAN }]
   171	    expect(preferredChoices(view, nothing)).toEqual(nothing)
   172	  })
   173	
   174	  it('feeds buildChoiceSet a board where each castable card is clickable once', () => {
   175	    const set = buildChoiceSet(view, preferredChoices(view, legal))
   176	    expect(set.byCard.get(card)?.filter((ch) => ch.command.type === 'castCharacter' || ch.command.type === 'castSummon')).toHaveLength(1)
   177	  })
   178	})
   179	
   180	// ---------------------------------------------------------------------------
   181	// Abilities (rung C1)
   182	// ---------------------------------------------------------------------------
   183	
   184	const NOEL = '16-092C', CLOUD = '27-124S', SPHENE = '27-126S', BILLY = '18-124C', REEVE = '20-105C'
   185	
   186	const fieldCard = (id: CardId, over: Partial<FieldCard> = {}): FieldCard =>
   187	  ({ id, status: 'active', damage: 0, enteredTurn: 1, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], ...over })
   188	
   189	/** Register a card instance in a view so the def tables can be looked up for it. */
   190	function instance(v: PlayerView, id: CardId, code: string, owner = HUMAN): CardId {
10:import { buildChoiceSet, describeChoice, fieldCardDisplay, preferredChoices, promptFor, sameCommand, samePayment } from '../src/game/commands.js'
139:describe('preferredChoices', () => {
142:  it('collapses one card with many payments to exactly one choice', () => {
144:    expect(preferredChoices(view, legal).filter((c) => isCastFor(c, card))).toHaveLength(1)
148:    const kept = preferredChoices(view, legal).find((c) => isCastFor(c, card))
155:    const collapsed = preferredChoices(view, legal)
161:    expect(unpayable(collapsed)).toEqual(unpayable(legal))
163:    const order = collapsed.filter((c) => c.type === 'castCharacter' || c.type === 'castSummon').map((c) => (c as Extract<Command, { type: 'castCharacter' }>).card)
171:    expect(preferredChoices(view, nothing)).toEqual(nothing)
175:    const set = buildChoiceSet(view, preferredChoices(view, legal))

exec
/bin/zsh -lc "node --import tsx --input-type=module -e \"import { canPay } from './packages/engine/src/cp.ts'; console.log(canPay(2,['lightning','lightning'],[{element:'lightning',source:1},{element:'earth',source:2}]))\"" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
true

exec
/bin/zsh -lc "node --import tsx --input-type=module -e 'import { apply } from \"./packages/engine/src/apply.ts\"; import { activationCheck } from \"./packages/engine/src/activate.ts\"; import { makeDef, makeGame, VANILLA_POOL, withField } from \"./packages/engine/test/helpers.ts\"; const ability={id:\"T-LATE:act\",trigger:{kind:\"activated\",sourceZone:\"field\",cost:{selfToBreakZone:true}},text:\"x\",effects:[{kind:\"forEach\",from:{zone:\"forwards\",controller:\"opponent\"},do:[{kind:\"dull\"}]},{kind:\"chooseTargets\",min:1,max:1,from:{zone:\"forwards\",controller:\"any\"},then:[{kind:\"addPower\",amount:4000}]}]}; const def=makeDef({code:\"T-LATE\",cost:1,power:5000,hasAbilities:true,abilityClauses:1,text:\"x\",abilities:[ability]}); let s=makeGame({defs:[...VANILLA_POOL,def]}); let src; [s,src]=withField(s,0,\"forwards\",\"T-LATE\"); console.log(\"check\",activationCheck(s,0,src,ability.id)); const r=apply(s,{type:\"activateAbility\",player:0,source:src,abilityId:ability.id,payment:{dullBackups:[],discards:[]}}); console.log(\"sourceInBreak\",r.state.players[0].breakZone.includes(src),\"pending\",r.state.pending,\"events\",r.events.map(e=>e.type));'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
check null
sourceInBreak true pending null events [
  'abilityActivated',
  'cpGenerated',
  'paidToBreakZone',
  'abilityTriggered',
  'abilityNoLegalTarget'
]

exec
/bin/zsh -lc "rg -n \"code: 'V-\" packages/engine/test/helpers.ts | head -80 && nl -ba packages/engine/test/helpers.ts | sed -n '1,160p'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
11:  makeDef({ code: 'V-F1', cost: 1, power: 3000 }),
12:  makeDef({ code: 'V-F2', cost: 2, power: 5000 }),
13:  makeDef({ code: 'V-F3', elements: ['lightning'], cost: 3, power: 7000 }),
14:  makeDef({ code: 'V-F4', elements: ['earth', 'lightning'], cost: 2, power: 7000 }),
15:  makeDef({ code: 'V-F5', cost: 3, power: 7000 }),
16:  makeDef({ code: 'V-F6', elements: ['lightning'], cost: 1, power: 2000 }),
17:  makeDef({ code: 'V-F7', cost: 4, power: 8000 }),
18:  makeDef({ code: 'V-F8', elements: ['lightning'], cost: 5, power: 9000 }),
19:  makeDef({ code: 'V-B1', type: 'backup', cost: 1, power: null }),
20:  makeDef({ code: 'V-B2', type: 'backup', elements: ['lightning'], cost: 2, power: null }),
21:  makeDef({ code: 'V-B3', type: 'backup', cost: 1, power: null }),
22:  makeDef({ code: 'V-B4', type: 'backup', cost: 3, power: null }),
23:  makeDef({ code: 'V-B5', type: 'backup', elements: ['lightning'], cost: 1, power: null }),
24:  makeDef({ code: 'V-B6', type: 'backup', elements: ['lightning'], cost: 3, power: null }),
25:  makeDef({ code: 'V-S1', type: 'summon', elements: ['lightning'], cost: 2, power: null }),
26:  makeDef({ code: 'V-S2', type: 'summon', cost: 1, power: null }),
27:  makeDef({ code: 'V-S3', type: 'summon', elements: ['lightning'], cost: 4, power: null }),
28:  makeDef({ code: 'V-S4', type: 'summon', cost: 3, power: null }),
     1	import type { CardDef, PlayerId } from '../src/types.js'
     2	import type { CardId, FieldCard, GameState } from '../src/state.js'
     3	import { applyChooseFirst, applyMulligan, createGame } from '../src/setup.js'
     4	
     5	export function makeDef(over: Partial<CardDef> & { code: string }): CardDef {
     6	  return { name: over.code, type: 'forward', elements: ['earth'], cost: 2, power: 5000, keywords: [], generic: false, exBurst: false, text: '', hasAbilities: false, ...over }
     7	}
     8	
     9	/** 18 distinct codes so deckOf() can build a legal 50-card deck (≤3 copies each needs ≥17 codes). */
    10	export const VANILLA_POOL: CardDef[] = [
    11	  makeDef({ code: 'V-F1', cost: 1, power: 3000 }),
    12	  makeDef({ code: 'V-F2', cost: 2, power: 5000 }),
    13	  makeDef({ code: 'V-F3', elements: ['lightning'], cost: 3, power: 7000 }),
    14	  makeDef({ code: 'V-F4', elements: ['earth', 'lightning'], cost: 2, power: 7000 }),
    15	  makeDef({ code: 'V-F5', cost: 3, power: 7000 }),
    16	  makeDef({ code: 'V-F6', elements: ['lightning'], cost: 1, power: 2000 }),
    17	  makeDef({ code: 'V-F7', cost: 4, power: 8000 }),
    18	  makeDef({ code: 'V-F8', elements: ['lightning'], cost: 5, power: 9000 }),
    19	  makeDef({ code: 'V-B1', type: 'backup', cost: 1, power: null }),
    20	  makeDef({ code: 'V-B2', type: 'backup', elements: ['lightning'], cost: 2, power: null }),
    21	  makeDef({ code: 'V-B3', type: 'backup', cost: 1, power: null }),
    22	  makeDef({ code: 'V-B4', type: 'backup', cost: 3, power: null }),
    23	  makeDef({ code: 'V-B5', type: 'backup', elements: ['lightning'], cost: 1, power: null }),
    24	  makeDef({ code: 'V-B6', type: 'backup', elements: ['lightning'], cost: 3, power: null }),
    25	  makeDef({ code: 'V-S1', type: 'summon', elements: ['lightning'], cost: 2, power: null }),
    26	  makeDef({ code: 'V-S2', type: 'summon', cost: 1, power: null }),
    27	  makeDef({ code: 'V-S3', type: 'summon', elements: ['lightning'], cost: 4, power: null }),
    28	  makeDef({ code: 'V-S4', type: 'summon', cost: 3, power: null }),
    29	]
    30	
    31	export function deckOf(codes: string[]): string[] {
    32	  if (codes.length < 17) throw new Error(`deckOf needs ≥17 codes for a legal deck, got ${codes.length}`)
    33	  const out: string[] = []
    34	  for (let i = 0; out.length < 50; i++) out.push(codes[i % codes.length] as string)
    35	  return out
    36	}
    37	
    38	export const DEFAULT_DECK = deckOf(VANILLA_POOL.map((d) => d.code))
    39	
    40	export function makeGame(opts: { seed?: number; decks?: [string[], string[]]; defs?: CardDef[] } = {}): GameState {
    41	  let s = createGame({ seed: opts.seed ?? 1, decks: opts.decks ?? [DEFAULT_DECK, DEFAULT_DECK], defs: opts.defs ?? VANILLA_POOL })
    42	  const chooser = s.pending?.kind === 'chooseFirst' ? s.pending.player : 0
    43	  ;[s] = applyChooseFirst(s, chooser, chooser === 0)   // player 0 always goes first
    44	  ;[s] = applyMulligan(s, 0, false)
    45	  ;[s] = applyMulligan(s, 1, false)
    46	  return s
    47	}
    48	
    49	let nextTestId = 10_000
    50	function addInstance(state: GameState, owner: PlayerId, code: string): [GameState, CardId] {
    51	  const id = nextTestId++
    52	  return [{ ...state, cards: { ...state.cards, [id]: { id, code, owner } } }, id]
    53	}
    54	function setPlayer(state: GameState, p: PlayerId, ps: GameState['players'][0]): GameState {
    55	  const players: GameState['players'] = [state.players[0], state.players[1]]
    56	  players[p] = ps
    57	  return { ...state, players }
    58	}
    59	
    60	export function withField(state: GameState, player: PlayerId, zone: 'forwards' | 'backups', code: string, over: Partial<FieldCard> = {}): [GameState, CardId] {
    61	  const [s, id] = addInstance(state, player, code)
    62	  const fc: FieldCard = { id, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false, granted: [], powerBonus: 0, flags: [], ...over }
    63	  const ps = s.players[player]
    64	  return [setPlayer(s, player, { ...ps, [zone]: [...ps[zone], fc] }), id]
    65	}
    66	
    67	export function withHand(state: GameState, player: PlayerId, code: string): [GameState, CardId] {
    68	  const [s, id] = addInstance(state, player, code)
    69	  const ps = s.players[player]
    70	  return [setPlayer(s, player, { ...ps, hand: [...ps.hand, id] }), id]
    71	}
    72	
    73	export function withHandSize(state: GameState, player: PlayerId, n: number): GameState {
    74	  const ps = state.players[player]
    75	  return setPlayer(state, player, { ...ps, hand: ps.hand.slice(0, n), deck: [...ps.deck, ...ps.hand.slice(n)] })
    76	}

exec
/bin/zsh -lc "node --import tsx --input-type=module -e 'import { enumeratePaymentsFor } from \"./packages/engine/src/cp.ts\"; import { preferredPaymentFor } from \"./packages/ai/src/payment.ts\"; import { makeGame, withField, withHand } from \"./packages/engine/test/helpers.ts\"; let s=makeGame(); s={...s,players:[{...s.players[0],hand:[]},s.players[1]]}; const ids=[]; let x; [s,x]=withField(s,0,\"backups\",\"V-B1\"); ids.push(x); [s,x]=withField(s,0,\"backups\",\"V-B2\"); ids.push(x); [s,x]=withHand(s,0,\"V-S2\"); ids.push(x); [s,x]=withHand(s,0,\"V-S1\"); ids.push(x); [s,x]=withHand(s,0,\"V-F4\"); ids.push(x); const reqEls=[[],[\"earth\"],[\"lightning\"],[\"earth\",\"lightning\"]]; let checked=0,bad=[]; for(let mask=0;mask<(1<<ids.length);mask++) for(let amount=0;amount<=6;amount++) for(const requiredElements of reqEls){ const excluded=ids.filter((_,i)=>mask&(1<<i)); const req={amount,requiredElements,excluded}; const all=enumeratePaymentsFor(s,0,req); const p=preferredPaymentFor(s,0,req); checked++; if(p&&"'!all.some(q=>JSON.stringify(q)===JSON.stringify(p))) bad.push({req,p,all}); if(!p&&all.length) bad.push({req,p,all}); } console.log({checked,bad:bad.length,first:bad[0]});'"'" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
{ checked: 896, bad: 0, first: undefined }

exec
/bin/zsh -lc "nl -ba packages/cards/data/cards.json | sed -n '238,266p'; rg -n \"27-126S|Sphene\" packages/cards/src/abilities.ts README.md docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md" in /Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai
 succeeded in 0ms:
   238	    "keywords": [],
   239	    "generic": false,
   240	    "exBurst": false,
   241	    "hasAbilities": true,
   242	    "text": "When Luso deals damage to a Forward, break it.\nWhen Luso deals damage to your opponent, select up to 2 of the 2 following actions. \"Choose 1 Forward. Deal it 3000 damage.\" \"Choose 1 Character in your Break Zone. Add it to your hand.\""
   243	  },
   244	  {
   245	    "code": "27-126S",
   246	    "name": "Sphene",
   247	    "type": "forward",
   248	    "elements": [
   249	      "lightning"
   250	    ],
   251	    "cost": 3,
   252	    "power": 7000,
   253	    "keywords": [],
   254	    "generic": false,
   255	    "exBurst": false,
   256	    "hasAbilities": true,
   257	    "text": "All cards in your Break Zone cannot be removed from the game by your opponent's Summons or abilities.\n[0]: Choose 1 Forward other than Sphene put in your Break Zone from the field during this turn. Add it to your hand. You can only use this ability during your turn and only once per turn."
   258	  },
   259	  {
   260	    "code": "27-127S",
   261	    "name": "Lightning",
   262	    "type": "forward",
   263	    "elements": [
   264	      "lightning"
   265	    ],
   266	    "cost": 7,
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:33:removed-from-game zone) and Sphene's `[0]` (needs field→Break-Zone history and once-per-turn state).
docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:55:| C3-12 | Not in scope | Undead Princess's second clause and the removed-from-game zone; Sphene; EX Burst; static abilities (Class Tenth Moogle's CP, Odin's cost reduction, Sphene's protection); deck knowledge (C6). |
packages/cards/src/abilities.ts:28: * one plus an activated one (Odin, Sphene) count both.
packages/cards/src/abilities.ts:47:  '27-126S': 2,   // static Break Zone protection | [0]: retrieve

codex
The six printed ASTs check out, including Noel: `forEach` is the right untargeted representation of “all,” and it snapshots the opponent-side candidate list before dulling. CP source exclusion and minimal-payment enumeration are also sound for the current pool; the remaining CP defect is in the advertised repeated-element generality, not these six costs.
Completed the static trace and two executable read-only counterexamples/probes. Focused Vitest collection was attempted but the sandbox prevented Vite from creating node_modules/.vite-temp.
  ✓ Read revision-2 spec and prior plan review; extract required invariants
  ✓ Trace engine transaction, CP enumeration, cost movement, and activation legality
  ✓ Audit six card ASTs, AI candidates/keys/evaluation, browser handling, and tests
  ✓ Run focused tests and adversarial checks, then report only evidenced findings
codex
## HIGH

**The post-cost preflight is not a valid replacement for activation-time target declaration.**

The spec requires targets on the activation command ([spec:44](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:44)), but the command omits them ([commands.ts:21–34](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/commands.ts:21)). The implementation:

- Checks only `ability.effects[0]` ([activate.ts:95–101](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:95)). A mandatory target after `draw`, `forEach`, `chooseModes`, or another `chooseTargets` is unchecked. I executed a synthetic `forEach → chooseTargets(min:1)` clause: `activationCheck` returned `null`, the source entered the Break Zone, and resolution emitted `abilityNoLegalTarget`.
- Rejects an empty candidate set even when `min === 0` ([activate.ts:100](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:100)), making an “up to N” ability illegally unactivatable.
- Does not snapshot candidates. Cost triggers are queued before the action ([activate.ts:182–185](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:182)), after which resolution recomputes candidates ([resolve.ts:236–240](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:236)) and re-derives them again when answering ([resolve.ts:483–491](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:483)). A cost trigger can therefore remove the preflighted target and let the player retarget, add a new target, or leave no target after payment.
- Already changes decision order with shipped cards: Undead Princess pays and fires an opponent Lightning; the opponent chooses its Haste target before the Princess player chooses the pump target ([abilities.ts:218–225](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:218), [abilities.ts:374–381](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:374)).
- Does not universally exclude the source. Exclusion happens only when the AST asks for it ([resolve.ts:122](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:122)); a self-to-Break-Zone cost followed by Break-Zone targeting can target its own source.

Several `chooseTargets` nodes absolutely break this design: only the first is preflighted, and later mandatory choices can no-op after payment.

**Fix:** For the current six, put the single target set on `activateAbility` and seed `Frame.chosen`. For a general AST, carry activation choices keyed by effect path, including modes and every activation-time target. If the UI must retain separate prompts, create an uncommitted activation draft: collect all declaration choices first, then validate and pay costs atomically. Never pay before declaration completes.

## MEDIUM

**Activated abilities are still narrated as both “activated” and “triggered.”**

Activation emits `abilityActivated` and then enqueues its action through the generic trigger path ([activate.ts:178–185](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:178)). Every frame start unconditionally emits `abilityTriggered` ([resolve.ts:420–428](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:420)), and the browser narrates both variants ([useGame.ts:77–87](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/src/game/useGame.ts:77)). This directly violates C3-A7.

**Fix:** Record frame origin (`triggered | activated`) or inspect the ability kind when starting it. Do not emit `abilityTriggered` for the action frame; retain it for cost-fired Lightning frames.

**The CP machinery is correct for these six clauses, but not for the repeated-element generality promised by the review.**

Source exclusion is correctly applied to Backups and discards ([cp.ts:29–52](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:29)). Enumeration covers every source combination and removes every non-minimal one ([cp.ts:91–131](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:91)). `[0]` produces only the empty payment in both engine and AI ([cp.ts:93](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:93), [payment.ts:62](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/payment.ts:62)); an unmakeable required Element yields no legal/preferred payment. A 896-requirement probe found every current `preferredPaymentFor` result in `enumeratePaymentsFor`.

However, `canPay` treats `requiredElements` as a set: `['lightning', 'lightning']` is satisfied by one Lightning CP plus one Earth CP ([cp.ts:58–62](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:58)). The AI also stores assignments in `Map<Element, Source>`, collapsing repeated requirements ([payment.ts:17–48](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/payment.ts:17)). That contradicts the repeated-cost rationale in the prior review ([codex-review.md:19749](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:19749)).

**Fix:** Treat requirements as a multiset and assign by requirement index, not Element key. Add `[Lightning][Lightning]` enumeration, application, and preferred-membership tests.

**`temporaryPower` removes the exact Princess tie, but is not a complete correctness model.**

The split correctly discounts positive `powerBonus` as material, but the entire temporary bonus still receives `threat` whenever the Forward is active ([evaluate.ts:100–112](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/evaluate.ts:100)). In Main Phase 2 that bonus cannot participate in combat before expiring. Separately, active and dull Backups receive identical value: only Backup count is scored ([evaluate.ts:114–116](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/evaluate.ts:114)). Thus spending ready CP still looks free.

Activation candidate legality and action keys themselves are sound for the implemented command: candidates reuse the engine check/requirement ([candidates.ts:321–332](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/candidates.ts:321)), and source/payment IDs are canonicalized while `abilityId` remains printed identity ([keys.ts:232–237](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/ismcts/keys.ts:232)). The target defect above makes the command semantically incomplete, not world-dependent.

**Fix:** Award temporary threat only when the card can still affect combat before end of turn, and add a small ready-Backup/available-CP term. Keep `temporaryPower`; 50.5% is unsurprising for such a narrow correction.

**The acceptance tests materially overstate their coverage.**

The engine suite explicitly tests synthetic cards ([activated-abilities.test.ts:13–18](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/test/activated-abilities.test.ts:13)); the card suite checks only that six IDs were installed, not that their real ASTs execute correctly ([abilities.test.ts:472–485](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/test/abilities.test.ts:472)). The “both agents” test instantiates two Greedy agents and stops searching after any one activation appears ([agents.test.ts:121–139](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/cli/test/agents.test.ts:121)). Browser C3 coverage constructs only Red Mage and does not test activation payment collapsing or narration ([commands.test.ts:453–495](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/test/commands.test.ts:453)).

**Fix:** Add table-driven tests over all six real definitions for `legalCommands`, `candidateCommands`, cost movement, and effect. Require every six to be reached, exercise both Greedy and ISMCTS, and assert that a completed activation log contains “activates” but no activated-clause “triggers.”

## LOW

**`activationCheck` is not genuinely identical to what `apply` enforces.**

It has no payment parameter and does not check affordability or payment sources ([activate.ts:63](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:63)); payment validation happens later ([activate.ts:120–128](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:120)). It also omits priority, which outer `apply` checks ([apply.ts:61–64](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/apply.ts:61)). An unknown source throws through `defOf` before returning an illegality reason ([activate.ts:38–41](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:38)).

Legal and AI enumeration compose these checks safely, so this does not currently make the agent emit rejected commands.

**Fix:** Rename it `activationBaseCheck`, or accept the complete activation command and make it the single validator for timing, source, declaration, and payment.

**`reason: 'cost'` is correct in the engine, but adjacent reason plumbing still loses distinctions.**

The cost transition and trigger event correctly carry the reason, while Lightning correctly does not filter it ([rules.ts:50–58](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:50), [resolve.ts:580–586](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:580)). No existing rules observer should filter it.

But browser reconstruction labels `broken`, `brokenByAbility`, and zero-power movement all as `ability` ([useGame.ts:195–200](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/src/game/useGame.ts:195)); narration treats every non-cost reason as “broken” ([commands.ts:65–71](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/src/game/commands.ts:65)); and the ISMCTS trigger digest omits `reason` entirely ([keys.ts:433–441](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/ismcts/keys.ts:433)). A hand-source self-discard is also mislabeled as a CP discard ([activate.ts:151–155](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:151)).

**Fix:** Preserve `damage`, `zeroPower`, `ability`, and `cost` separately through reconstruction and observation keys; add `discarded.reason: 'cost'`.

**README status and the documented deviation were not updated.**

It still says 10/28 clauses and that all ten are triggered ([README.md:23–26](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/README.md:23)), and it does not list action abilities as sorcery-speed despite C3-11 requiring that disclosure.

**Fix:** Update coverage to 16/28 and add the Main-Phase-only/action-ability deviation.

**The remaining transaction and all six printed ASTs are sound.**

Invalid CP throws before mutation; Pending blocks activation; cost watchers precede the action; `settle` preserves FIFO across prompts; and `abilityOf` reads the global instance/definition rather than requiring the source to remain on the field ([activate.ts:173–185](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:173), [apply.ts:45–55](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/apply.ts:45), [resolve.ts:95–100](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:95)). Noel’s `forEach` correctly means every opponent Forward, including already-dull ones, with no target choice ([abilities.ts:348–352](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:348)). The other five costs, source zones, target scopes, and effects match their quoted text.

**Fix:** None beyond the activation-declaration substrate above.

## WHAT I WOULD DO DIFFERENTLY

**Fix activation declaration before starting C4.** A declaration draft that gathers modes/targets before committing costs would preserve the existing Pending UI while restoring atomicity. Update AI action keys and browser payment grouping to include the declared target/path choices.

**Implement Undead Princess’s remove-from-game clause next.** It is the narrower extension: add a public removed-from-game zone, `selfRemoveFromGame` cost, view/determinisation/key support, then reuse the corrected declaration transaction.

**Implement Sphene after that with explicit reusable state.** Track field→Break-Zone transition history and per-source/per-ability once-per-turn usage; do not infer either from current Break-Zone contents. `[0]` payment itself is already correct.

Focused Vitest could not start in this read-only sandbox because Vite attempted to create `node_modules/.vite-temp`; the executable counterexamples and payment sweep above ran directly through the TypeScript modules.
tokens used
294,328
## HIGH

**The post-cost preflight is not a valid replacement for activation-time target declaration.**

The spec requires targets on the activation command ([spec:44](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/specs/2026-08-27-rung-c3-activated-abilities.md:44)), but the command omits them ([commands.ts:21–34](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/commands.ts:21)). The implementation:

- Checks only `ability.effects[0]` ([activate.ts:95–101](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:95)). A mandatory target after `draw`, `forEach`, `chooseModes`, or another `chooseTargets` is unchecked. I executed a synthetic `forEach → chooseTargets(min:1)` clause: `activationCheck` returned `null`, the source entered the Break Zone, and resolution emitted `abilityNoLegalTarget`.
- Rejects an empty candidate set even when `min === 0` ([activate.ts:100](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:100)), making an “up to N” ability illegally unactivatable.
- Does not snapshot candidates. Cost triggers are queued before the action ([activate.ts:182–185](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:182)), after which resolution recomputes candidates ([resolve.ts:236–240](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:236)) and re-derives them again when answering ([resolve.ts:483–491](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:483)). A cost trigger can therefore remove the preflighted target and let the player retarget, add a new target, or leave no target after payment.
- Already changes decision order with shipped cards: Undead Princess pays and fires an opponent Lightning; the opponent chooses its Haste target before the Princess player chooses the pump target ([abilities.ts:218–225](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:218), [abilities.ts:374–381](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:374)).
- Does not universally exclude the source. Exclusion happens only when the AST asks for it ([resolve.ts:122](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:122)); a self-to-Break-Zone cost followed by Break-Zone targeting can target its own source.

Several `chooseTargets` nodes absolutely break this design: only the first is preflighted, and later mandatory choices can no-op after payment.

**Fix:** For the current six, put the single target set on `activateAbility` and seed `Frame.chosen`. For a general AST, carry activation choices keyed by effect path, including modes and every activation-time target. If the UI must retain separate prompts, create an uncommitted activation draft: collect all declaration choices first, then validate and pay costs atomically. Never pay before declaration completes.

## MEDIUM

**Activated abilities are still narrated as both “activated” and “triggered.”**

Activation emits `abilityActivated` and then enqueues its action through the generic trigger path ([activate.ts:178–185](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:178)). Every frame start unconditionally emits `abilityTriggered` ([resolve.ts:420–428](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:420)), and the browser narrates both variants ([useGame.ts:77–87](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/src/game/useGame.ts:77)). This directly violates C3-A7.

**Fix:** Record frame origin (`triggered | activated`) or inspect the ability kind when starting it. Do not emit `abilityTriggered` for the action frame; retain it for cost-fired Lightning frames.

**The CP machinery is correct for these six clauses, but not for the repeated-element generality promised by the review.**

Source exclusion is correctly applied to Backups and discards ([cp.ts:29–52](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:29)). Enumeration covers every source combination and removes every non-minimal one ([cp.ts:91–131](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:91)). `[0]` produces only the empty payment in both engine and AI ([cp.ts:93](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:93), [payment.ts:62](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/payment.ts:62)); an unmakeable required Element yields no legal/preferred payment. A 896-requirement probe found every current `preferredPaymentFor` result in `enumeratePaymentsFor`.

However, `canPay` treats `requiredElements` as a set: `['lightning', 'lightning']` is satisfied by one Lightning CP plus one Earth CP ([cp.ts:58–62](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/cp.ts:58)). The AI also stores assignments in `Map<Element, Source>`, collapsing repeated requirements ([payment.ts:17–48](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/payment.ts:17)). That contradicts the repeated-cost rationale in the prior review ([codex-review.md:19749](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/docs/superpowers/plans/2026-08-27-rung-c3-activated-abilities.codex-review.md:19749)).

**Fix:** Treat requirements as a multiset and assign by requirement index, not Element key. Add `[Lightning][Lightning]` enumeration, application, and preferred-membership tests.

**`temporaryPower` removes the exact Princess tie, but is not a complete correctness model.**

The split correctly discounts positive `powerBonus` as material, but the entire temporary bonus still receives `threat` whenever the Forward is active ([evaluate.ts:100–112](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/evaluate.ts:100)). In Main Phase 2 that bonus cannot participate in combat before expiring. Separately, active and dull Backups receive identical value: only Backup count is scored ([evaluate.ts:114–116](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/evaluate.ts:114)). Thus spending ready CP still looks free.

Activation candidate legality and action keys themselves are sound for the implemented command: candidates reuse the engine check/requirement ([candidates.ts:321–332](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/candidates.ts:321)), and source/payment IDs are canonicalized while `abilityId` remains printed identity ([keys.ts:232–237](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/ismcts/keys.ts:232)). The target defect above makes the command semantically incomplete, not world-dependent.

**Fix:** Award temporary threat only when the card can still affect combat before end of turn, and add a small ready-Backup/available-CP term. Keep `temporaryPower`; 50.5% is unsurprising for such a narrow correction.

**The acceptance tests materially overstate their coverage.**

The engine suite explicitly tests synthetic cards ([activated-abilities.test.ts:13–18](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/test/activated-abilities.test.ts:13)); the card suite checks only that six IDs were installed, not that their real ASTs execute correctly ([abilities.test.ts:472–485](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/test/abilities.test.ts:472)). The “both agents” test instantiates two Greedy agents and stops searching after any one activation appears ([agents.test.ts:121–139](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/cli/test/agents.test.ts:121)). Browser C3 coverage constructs only Red Mage and does not test activation payment collapsing or narration ([commands.test.ts:453–495](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/test/commands.test.ts:453)).

**Fix:** Add table-driven tests over all six real definitions for `legalCommands`, `candidateCommands`, cost movement, and effect. Require every six to be reached, exercise both Greedy and ISMCTS, and assert that a completed activation log contains “activates” but no activated-clause “triggers.”

## LOW

**`activationCheck` is not genuinely identical to what `apply` enforces.**

It has no payment parameter and does not check affordability or payment sources ([activate.ts:63](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:63)); payment validation happens later ([activate.ts:120–128](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:120)). It also omits priority, which outer `apply` checks ([apply.ts:61–64](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/apply.ts:61)). An unknown source throws through `defOf` before returning an illegality reason ([activate.ts:38–41](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:38)).

Legal and AI enumeration compose these checks safely, so this does not currently make the agent emit rejected commands.

**Fix:** Rename it `activationBaseCheck`, or accept the complete activation command and make it the single validator for timing, source, declaration, and payment.

**`reason: 'cost'` is correct in the engine, but adjacent reason plumbing still loses distinctions.**

The cost transition and trigger event correctly carry the reason, while Lightning correctly does not filter it ([rules.ts:50–58](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/rules.ts:50), [resolve.ts:580–586](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:580)). No existing rules observer should filter it.

But browser reconstruction labels `broken`, `brokenByAbility`, and zero-power movement all as `ability` ([useGame.ts:195–200](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/src/game/useGame.ts:195)); narration treats every non-cost reason as “broken” ([commands.ts:65–71](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/apps/web/src/game/commands.ts:65)); and the ISMCTS trigger digest omits `reason` entirely ([keys.ts:433–441](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/ai/src/ismcts/keys.ts:433)). A hand-source self-discard is also mislabeled as a CP discard ([activate.ts:151–155](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:151)).

**Fix:** Preserve `damage`, `zeroPower`, `ability`, and `cost` separately through reconstruction and observation keys; add `discarded.reason: 'cost'`.

**README status and the documented deviation were not updated.**

It still says 10/28 clauses and that all ten are triggered ([README.md:23–26](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/README.md:23)), and it does not list action abilities as sorcery-speed despite C3-11 requiring that disclosure.

**Fix:** Update coverage to 16/28 and add the Main-Phase-only/action-ability deviation.

**The remaining transaction and all six printed ASTs are sound.**

Invalid CP throws before mutation; Pending blocks activation; cost watchers precede the action; `settle` preserves FIFO across prompts; and `abilityOf` reads the global instance/definition rather than requiring the source to remain on the field ([activate.ts:173–185](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/activate.ts:173), [apply.ts:45–55](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/apply.ts:45), [resolve.ts:95–100](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/engine/src/resolve.ts:95)). Noel’s `forEach` correctly means every opponent Forward, including already-dull ones, with no target choice ([abilities.ts:348–352](/Users/danielroach/repos/fftcg-game/.claude/worktrees/rung-a-heuristic-ai/packages/cards/src/abilities.ts:348)). The other five costs, source zones, target scopes, and effects match their quoted text.

**Fix:** None beyond the activation-declaration substrate above.

## WHAT I WOULD DO DIFFERENTLY

**Fix activation declaration before starting C4.** A declaration draft that gathers modes/targets before committing costs would preserve the existing Pending UI while restoring atomicity. Update AI action keys and browser payment grouping to include the declared target/path choices.

**Implement Undead Princess’s remove-from-game clause next.** It is the narrower extension: add a public removed-from-game zone, `selfRemoveFromGame` cost, view/determinisation/key support, then reuse the corrected declaration transaction.

**Implement Sphene after that with explicit reusable state.** Track field→Break-Zone transition history and per-source/per-ability once-per-turn usage; do not infer either from current Break-Zone contents. `[0]` payment itself is already correct.

Focused Vitest could not start in this read-only sandbox because Vite attempted to create `node_modules/.vite-temp`; the executable counterexamples and payment sweep above ran directly through the TypeScript modules.
exit=0
