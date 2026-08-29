# Rung E8 — the game can be heard

> **STATUS: REFUSED as written; rewritten below and cleared to build.** The defect and the direction are
> right; the acceptance could certify a broken live-region lifecycle. Read *Plan review outcome* first. The defect was NAMED BY THE E7 CLOSURE REVIEW when
> asked for the strongest remaining one in `apps/web`, and rated CRITICAL.

## Why

The whole of rung E3 made the cards *readable*. Nothing makes the game *audible*.

Measured in a real browser, on the opening screen:

```
elements with a live region role or attribute: 0
prompt text element: <span class="prompt__text">  role=null  aria-live=null
```

**Zero.** The prompt computes the entire instruction — the attacker's identity and power, what triggered a
choice, "click a highlighted card" — and renders it in an ordinary `<span>`. The game log appends ordinary
`<p>`s and calls `scrollIntoView()`, which tells a sighted player where to look and a screen-reader player
nothing at all.

So after the AI takes its turn, a screen-reader player is told neither **what happened** nor **what is now
required**. This is a turn-based game against an AI: those two facts are the entire interface.

Focus restoration does not cover it. It only runs when the strip already had focus and a suitable button
exists — and a focused "Don't block" button announces "Don't block", not *"Choose a blocker for Cloud
(power 7000)"*. A card-only target decision can leave focus on `body` while its sole instruction changes
silently elsewhere in the DOM.

E3 and E7 both ended up being about the same thing: making a *state* announce itself to the person who cannot
see it. This is the last and largest instance — the state that changes most often.

## What this rung is

Give the game the two channels it lacks:

1. **What is required** — the prompt text becomes a live region, so a changed instruction is announced
   without stealing focus.
2. **What happened** — the AI's actions reach the player somehow.

## The question I cannot answer from the code

**How much of the log should speak?** An FFTCG turn produces a great many events — phase changes, triggers,
damage, breaks. Two shapes, and I do not know which is right:

- **`role="log"` on the event log.** Standard, no invention, announces each appended line. But a single AI
  turn can add a dozen lines, and a player who must hear all of them before acting may find the game
  unusable in a different way.
- **A summary region**: one composed sentence covering what the AI did since the player last acted. Quieter
  and probably kinder — but it is invented prose, and this program has already refused one rung for inventing
  English the cards do not print.

I lean to `role="log"` because it needs no invented wording, with the verbosity treated as a separate
question if playing shows it is too much. But this is exactly the kind of call I have got wrong before, so
the plan review should rule.

## What this rung is NOT

- **Not a change to any wording.** The prompt strings are settled (E5 named the attacker; E6 phrased the
  ending). This is about whether they are announced, not what they say.
- **Not a focus change.** A live region announces *without* moving focus; that is the point. Moving focus on
  a state change is the WCAG 3.2.5 violation the PromptStrip work already exists to avoid.
- Not the CLI.

## Acceptance

- **E8-A1** The prompt's instruction is inside a live region, and its politeness is asserted explicitly
  (`polite`, not `assertive` — an interruption on every phase change would be intolerable).
- **E8-A2** When the instruction CHANGES, the live region's content changes with it — asserted by driving a
  real state transition in a mounted Board, not by rendering two fixtures side by side.
- **E8-A3** The region is present in the DOM **before** the text it will announce. A live region added at
  the same moment as its content is not reliably announced, which is the single most common way this is got
  wrong.
- **E8-A4** Whatever is ruled for the log, its announcement channel exists and carries a real event from a
  real game.
- **E8-A5** No focus moves as a result of any of this. Asserted by driving the transition and checking
  `document.activeElement` is unchanged.
- **E8-A6** Existing tests pass unedited; full gates green, including `pnpm test:browser`.

## Mutation plan

| mutation | must fail |
|---|---|
| the live region role removed | A1 |
| `aria-live="assertive"` instead of polite | A1 |
| the region rendered only when there is text | A3 |
| the instruction moved outside the region | A2 |
| the transition also moves focus | A5 |
| the log's channel removed | A4 |

## A caution for the build

jsdom will happily assert every attribute here and can prove **none** of the behaviour — a live region is a
promise to assistive technology, and neither jsdom nor Playwright announces anything. So these tests pin a
CONTRACT, and the file must say so. That is the same honest split as E7, where jsdom proved `showModal` was
called and only a real browser proved the board went inert; here even the browser cannot close the loop.
Claiming otherwise would be the exact failure this program keeps catching.

---

## Plan review outcome — refused, with the open questions ruled

### The rulings I asked for

- **`role="log"` on the existing event log**, labelled by the "Game log" heading. **Not** a summary region:
  `log` exists precisely for sequential additions, and a summary would invent selection rules and prose
  unrelated to an accessibility repair. My lean was right, and for the right reason.
- **`.prompt__text` becomes a stable `role="status"` with explicit `aria-live="polite"` and
  `aria-atomic="true"`.** Explicit atomicity because some environments do not honour the implicit value.
- **Do NOT put the instruction into the restored button's label.** That is the option I floated in the
  brief, and it is the worst of both: it creates the real duplicate announcement *and* still fails
  card-only decisions, where there is no suitable button at all.
- **Keep the existing focus restoration.** The status owns the instruction; restoration owns keyboard
  position. They coexist.

### CRITICAL 1 — my A3 mutation cannot fail, and A2 proves React works

A3's mutation was "render the region only when there is text". `PromptStrip.text` is **never empty** — game
over, thinking, waiting, or a prompt, there is always a string. So the mutant and the correct implementation
have identical lifecycles and the criterion cannot bite.

A2 was worse in a quieter way: "the region's content changes when the instruction changes" is trivially true
of any element that renders the text at all. It proves the React dataflow, not that an **already-existing
live container received an update** — which is the entire mechanism a live region depends on.

Corrected: capture the `.prompt__text` **Element object** before a real transition, assert its exact
hand-written old instruction, drive the transition, and assert the new instruction is inside **that same
node** — with `key={text}` as the mutation, which replaces the element and must fail on node identity.

Also noted, and worth stating rather than glossing: the span exists before every *subsequent* update but not
before its own first content on mount, so A3 is explicitly about post-mount changes. First-mount
announcement is a different implementation and not this rung.

### CRITICAL 2 — my A5 contradicted a behaviour the repo already requires

I wrote "no focus moves as a result of any of this", asserted as `activeElement` unchanged. But
`PromptStrip` **deliberately** focuses a new action after the player used the strip and control returned —
and `focus.test.tsx` requires that. So A5 was either red against correct behaviour, or written from an
unrelated focus position and vacuous.

Replaced with two obligations that can both hold: with focus on an external sentinel, the transition leaves
that exact node focused; and the existing restoration test passes **unedited**.

### MAJOR — A4 was narrower than the defect it was written for

"Carries a real event from a real game" is satisfied by an opening line or by the player's own action. The
named defect is that **the AI acts silently**. So: the same pre-existing `role="log"` node must gain an
exact, hand-written **AI-authored** line after a real AI command, with the prior line still present.

### MAJOR — my role-removal mutation was equivalent, and would have died in the locator

With both `role="status"` and `aria-live="polite"` present, removing only the role leaves a working generic
polite region. Four separate mutations are needed: the role, both channels together, atomicity, and
politeness.

And they must be driven through **class** locators, not role locators — otherwise removing the role makes
the locator fail to match and the test dies before reaching its assertion. That is exactly how my `<div>`
mutation of the game-over dialog fooled me yesterday: a red run whose redness came from the locator, not the
claim.

### MAJOR — my honesty caution was too absolute

I wrote that jsdom can prove "none of the behaviour". Too strong. jsdom proves state-to-content flow, node
identity, containment and focus. Playwright can assert the browser's **computed accessibility tree** via ARIA
snapshots, and Chromium's accessibility protocol exposes computed `live`, `atomic` and `relevant`.

The honest boundary: **automation proves the DOM and the browser-accessibility contract; only a real
screen-reader exercise establishes that anything was actually announced** — its timing, ordering,
interruption and duplication included. Overclaiming a limitation is its own kind of inaccuracy.

## Revised acceptance

- **E8-A1** `.prompt__text` carries `role="status"`, `aria-live="polite"`, `aria-atomic="true"`, pinned by
  four independent mutations (role; both channels; atomicity; politeness), each driven by a class locator.
- **E8-A2** Across a real transition, the exact new instruction appears inside the **same Element object**
  captured beforehand, whose exact old instruction was asserted first.
- **E8-A3** That node is not replaced across the transition — killed by `key={text}`. Explicitly about
  post-mount changes.
- **E8-A4** The event log is `role="log"`, labelled by its heading, and gains an exact hand-written
  **AI-authored** line after a real AI command, with the previous line still present.
- **E8-A5** With focus on an external sentinel, a transition leaves that exact node focused; and
  `focus.test.tsx` passes unedited.
- **E8-A6** A Playwright assertion on the computed accessibility tree, since that is available and I had
  wrongly assumed it was not.
- **E8-A7** Existing tests pass unedited; full gates green including `pnpm test:browser`.
