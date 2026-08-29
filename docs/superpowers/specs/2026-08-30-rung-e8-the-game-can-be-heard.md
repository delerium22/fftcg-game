# Rung E8 — the game can be heard

> **STATUS: SPEC, awaiting plan review.** Nothing built. The defect was NAMED BY THE E7 CLOSURE REVIEW when
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
