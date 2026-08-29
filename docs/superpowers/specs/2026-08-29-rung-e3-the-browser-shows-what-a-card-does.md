# Rung E3 — the browser shows what a card does

> **STATUS: REFUSED as written, then split. Building E3a.**
> The defect is real and the panel is the right answer — the reviewer says so plainly. What it refused is
> this plan's acceptance, which could go green with the panel wired to nothing, and its claim to CLOSE the
> defect while keyboard users stay blind at the very decision that motivated it. Read *Plan review outcome*
> before treating anything above as a plan.

## Why

Found by playing the browser, ten seconds in. The game opened, dealt five cards, and asked:

> **Keep your hand or mulligan**
> Class Tenth Moogle · Ramuh · Odin · Undead Princess · Red Mage

There is no way to find out what any of them does. Clicking a card does nothing (verified: the only change
to the accessibility tree was the *Keep hand* button losing focus). Hovering gives the browser's native
`title`, and `title` is set to the same string as `aria-label` — `"Ramuh, cost 2, lightning, summon"`. Name,
cost, element, type, power. Never the card's text.

So every decision in the game is made blind unless the player already knows the pool by heart: the mulligan,
every cast, and — worst — every target choice, where the button says *Dull Cloud* and the player cannot check
what the opponent's Cloud does back. The AI reads the ability AST directly. The human is the only participant
who cannot see the cards.

The terminal is *ahead of the browser* here, which is the tell. It prints `describeAbilityCost` /
`describeAbilityEffect` at the point of decision and, since earlier today, a clause line above the menu
saying why a choice is being asked. The browser has the richer surface and shows less.

`def.text` — the full printed text — is already on `CardDef`, already inside `viewFor`'s `defs`, already in
the browser's memory on every render. Nothing needs to be plumbed. It is simply never displayed.

## What this rung is

A **card details panel**, in the rail that already holds the game log, showing the full printed text of one
card at a time: whichever card the player last hovered or focused.

This is what every digital TCG client does — Forge and the Hearthstone simulators both blow up a card on
hover — and it is the right shape here for a specific reason: the card face is 
too small for ~200 characters of text, and the decisions that need the text (mulligan, cast, target) all
happen while the player is already pointing at a card.

### Honest about what the engine implements

The panel must not print the full printed text as though the engine necessarily honours all of it. The
engine can emit `has abilities that are not implemented yet (played as vanilla)` when a card is cast, and
showing text without that caveat would move the lie earlier: the player would read a clause, plan around it,
and find it never fires.

**Checked before writing the plan, and it moved the plan.** I audited the pool expecting to find cards with
missing clauses. There are none: all **18** cards are fully implemented, and none is vanilla —
`abilityClauses − abilities.length − inertClauses` is `0` for every card, and `printed > 0` for every card.
So the `unimplementedAbility` event the engine can emit is, in this pool, unreachable, and the caveat this
section asks for would be a branch no game can enter.

That does not kill the caveat, but it changes what honest acceptance for it looks like — see A2 below. The
panel is a pure function of a `CardDef`, so a hand-built def is its natural unit, not a fake. What would be
dishonest is a criterion claiming to have found such a card *in the pool*.

`CardDef` already carries exactly enough to say this honestly:

| field | meaning |
|---|---|
| `text` | everything the card prints |
| `abilities[].text` | the clauses this build implements, each with its own printed text |
| `abilityClauses` | how many clauses `text` prints (absent ⇒ `hasAbilities ? 1 : 0`) |
| `inertClauses` | clauses deliberately unimplemented because they cannot do anything in THIS pool |

So `abilityClauses − abilities.length − inertClauses` is the number of clauses that are printed, live, and
missing. When that is greater than zero the panel says so, next to the text.

**The panel must not compute that itself.** `warnUnimplemented` in `resolve.ts` already computes exactly this,
`Math.max(0, …)` and all, and it is the thing whose answer the game log prints. A second copy in the browser
would be two implementations of one rule that must agree, which is the duplication rung E2 just finished
removing — and the drift would be worse here than there, because the panel and the log would be telling the
player two different stories about the same card. Extract `missingClauses(def): number` into the engine's
pure module, have `warnUnimplemented` call it, and have the panel call it. One rule, one implementation.

### Deliberately NOT in this rung

- **Not card art.** The image CDN 403-blocks this machine at the IP level; the app is designed to play with
  zero art and that stays true.
- **Not a change to any existing label, button, or prompt.** The panel is additive. If a web expectation has
  to move, something was broken, not updated.
- **Not click-to-inspect.** A hand card during a cast choice is already a `<button>` whose click plays it.
  Overloading that click is how a player casts a card they meant to read.
- **Not mobile layout.** Explicitly out of scope since B10.

## The keyboard gap, stated rather than papered over

Cards that are *selectable* are real `<button>`s, so they take focus already and inspect-on-focus covers them
for free. Cards that are not selectable are `role="img"` divs and are not in the tab order — which means a
keyboard-only player can inspect the cards they can act on, but not the AI's forwards, and choosing an attack
needs the defender's text.

The fix is a roving-tabindex group per zone (arrow keys within a zone, one tab stop per zone), which is the
standard pattern and is a rung of its own — adding `tabindex="0"` to every card instead would put ~20 stops
in the tab order and undo the PromptStrip focus work from earlier today. **This rung ships the mouse path and
the interactive-card keyboard path, and records the gap.** Marking it done would be the dishonest version.

## Acceptance

- **E3-A1** For a card with implemented abilities, the panel shows its full printed `text`. Asserted against
  a hand-written expected string for a named card, not against whatever `defs` returns for it.
- **E3-A2** For a def with printed clauses this build does not implement, the panel says so. Asserted
  against a HAND-BUILT def, because the pool contains no such card — stated in the panel's own comment so
  the next reader does not go looking for one. Paired with A2b so the branch cannot rot unnoticed.
- **E3-A2b** A pool invariant, in the cards package: every card is fully implemented
  (`abilityClauses − abilities.length − inertClauses === 0`). This is the alarm. Today it documents a fact;
  the day the pool gains an unimplemented clause it fires, and the panel's caveat starts mattering for real.
  Without it, A2's branch is tested but nothing ever tells us whether it is live.
- **E3-A3** A def with no abilities shows no caveat and no empty text block — also hand-built, for the same
  reason: the pool has no vanilla card either.
- **E3-A4** Inspecting is driven by hover AND by focus, and the two are pinned by separate assertions,
  because a handler wired to only one of them satisfies a test that checks "the panel updated".
- **E3-A5** The panel does not clear when the pointer leaves a card. Pinned by a test that moves the pointer
  off and asserts the text is still there. (Clearing on mouseout makes the panel flicker and makes it
  useless for the case that matters — reading a card, then moving to the button that acts on it.)
- **E3-A6** Clicking a selectable card still plays it, unchanged. Existing web tests pass with no expectation
  edited.
- **E3-A7** Full gates green; `selfplay --games 200 --seed 1` 200/200.

## Mutation plan

Each acceptance criterion above is worthless unless the corresponding mutation reddens it. Before closing:
render the panel with the caveat hard-coded off (A2 must fail), with the hover handler removed (A4a), with
the focus handler removed (A4b), with a clear-on-mouseout added (A5), and with `text` replaced by the
existing `label` string (A1 must fail — this is the mutation that catches "the panel shows *a* string").

For A2b the mutation is on the DATA, not the code: drop one clause from an implemented card's `abilities`
and confirm the invariant reddens. An invariant asserted over a set that happens to satisfy it is the
easiest kind of test to write and the easiest to write wrong.

---

## Plan review outcome — refused, split into E3a and E3b

Fourth refusal in a row, and the fourth that was right.

### CRITICAL 1 — every criterion could pass with the panel wired to nothing

A1–A3 test `CardDetails` directly, A4–A5 test `Card` callbacks in a harness, A6 leans on existing tests. A
mutant where `Board` never stores the inspected card, never passes the handlers, or never renders the panel
survives all of it. And the existing web tests cannot catch it: `card.test.tsx` and the Board test are
static-markup renders that cannot drive hover, focus or clicks at all.

So the plan's real integration point — `Board.tsx`, four separate card-rendering paths and the rail — had
no acceptance on it whatsoever. **A mounted-Board test starting from a real mulligan view is now mandatory**,
mutated by disconnecting the callback and by removing the panel from the rail.

### CRITICAL 2 — the mutation that mattered was the one I did not plan

My mutation plan had "replace `text` with the existing `label`". That catches a lazy panel. It does not
catch the dangerous one:

```ts
def.abilities?.map((a) => a.text).join('\n')   // NOT def.text
```

For Cloud, joining the two AST clause texts **happens to reconstruct the printed text exactly**. So A1
passes, on a real named card, while the panel renders the wrong field — and the field it renders is
precisely the one that omits unimplemented printed clauses, which is the entire thing the panel exists to
disclose. It would have shipped, looking correct, silently failing at its own purpose the day the pool gains
an unimplemented clause.

A2's hand-built def must therefore assert the complete `def.text` *including* the missing clause, made
deliberately distinct from the concatenation of the implemented ones, and both wrong-field mutants must red.

### CRITICAL 3 — the keyboard gap is at the mulligan, not at the AI's forwards

I wrote that a keyboard-only player could inspect cards they can act on but not the AI's forwards. That was
wrong in the worst direction. **Mulligan is a subjectless command**, so no hand card enters `choices.byCard`,
so `Board` passes `selectable={false}`, so all five cards are unfocusable `role="img"` divs. A keyboard-only
player is blind at *the exact decision in the "Why" section of this spec*. Same for inspecting attackers
while choosing a blocker.

The reviewer's words: shipping E3 with that gap "is not defensible as completion of this defect."

**So it is not shipped as completion of it.** Split, taking the reviewer's second option explicitly:

- **E3a — the details panel** (pointer, plus cards that are already focusable). A *precursor*. It does NOT
  close this defect and its spec says so in its status line.
- **E3b — roving tabindex** per face-up zone (arrow keys within a zone, one tab stop per zone), with
  mutation-backed mulligan and blocking tests. **This** is what closes it.

Two small rungs beat one big one and beat one dishonest one.

### CRITICAL 4 — "existing web tests pass" is not a click-preservation test

There is no interactive Board test, so a mutant that wires `onMouseEnter` to the command, or swaps `onClick`
for inspection, survives A6 entirely. Needs a real mounted assertion: hover and focus submit nothing; one
click on a single-choice selectable card submits exactly that `Choice`.

### MAJOR 1 — extract the shared helper (confirmed independently)

I had already reached this while checking my formula against `warnUnimplemented` and folded it in before
sending. The review confirms it and supplies the cases to pin: omitted `abilityClauses` + `hasAbilities`
+ no AST → 1; three printed, one implemented, one inert → 1; complete def → 0; overcoverage → 0 after the
clamp. The clamp is the part a re-derivation drops.

### MAJOR 3 — and the answer to the question I asked

I asked whether one panel is the wrong shape for blocking, where two cards must be compared. **It is not.**
A persistent last-inspected panel permits serial comparison, and the card faces keep showing effective
power, damage, grants and flags simultaneously — so no two-panel comparator, and no E1-style missing
semantic half for pointer users: the prompt already explains what will happen, the panel explains the
candidate. But a real `declareBlock` position must be shown to allow inspecting attacker *and* candidate
blocker. Today, by keyboard, it does not — which is E3b again.

### MINOR 1 — `hasAbilities` is not "has printed text"

Normalisation deliberately excludes keyword-only lines from `hasAbilities`. So a panel that renders text
only when `hasAbilities` is true passes the whole current pool and my vanilla fixture, while silently
dropping a printed `Haste` or `Brave` from any future keyword-only card. Needs a hand-built
`hasAbilities: false, text: "Haste"` def, and `text: ""` tested separately for the empty case.

### MINOR 2 — the rail is a constrained flex column and the log currently claims full height

Needs a look at the longest card text at the minimum supported desktop width, with both the details and a
scrollable log still reachable.

### Cut, on the reviewer's advice

The 200-game selfplay gate. A pure UI rung gains nothing from it beyond the ordinary full gates — and I had
put it in A7 out of habit rather than because it could catch anything here.
