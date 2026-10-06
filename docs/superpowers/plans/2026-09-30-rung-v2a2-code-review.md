# Rung V2-A2 — code review adjudication (2026-10-07)

Codex (xhigh), read-only on the repo with probes in /tmp, against feat/v2a2-replacements at c46035d (rebased onto main
951f4ae, with the Porom equal-shields decision). No CRITICAL or HIGH. Checked with no issue: every battle, First Strike,
multi-target and `forEach` path collects all orders before any packet lands; the `damageScope` rollback restores state,
events, steps, path and cursor without duplicating answers; 0 damage emits no occurrence, and a shield after a
non-positive running amount survives; `chooseReplacementOrder` is handled by every exhaustive consumer (apply, legal
commands, invariants, greedy, web and CLI equality and wording, ISMCTS key and decoder) with no determinisation leak; the
shield badge, moved into `boardModel.ts` by the rebase, reaches both players' field cards, the sheet and the accessible
name (probe: own [2000], opponent [3000]).

**Decided (2026-10-06), the open Porom question:** two orders are one outcome when they give the same final amount and
use up the same MULTISET of shield amounts (c46035d). The handoff's recommendation said "total amount consumed"; that
total would hide a real choice — 2000 against shields of 1000, 1000 and 2000 leaves {2000}, {1000} or {1000, 1000}, and
a second hit this turn tells them apart. Every shield the pool will grant is Porom's 2000, so the two rules agree on every
reachable board. Recorded in the spec's as-built note; pinned by three tests.

**Fixed now:** L1 (verified by probe, reproduced by a failing test) — a shield id is `<source>:<turn>:<n>` with `n` the
count the Forward carries, so after `…:0` is used up and `…:1` kept, a regrant from the same source made a second `…:1`;
the invariants flagged it and the next hit removed both. `n` now counts on past an id still in use. Not reachable with
Porom (it pays by going to the Break Zone, and a Backup re-enters dull), but `shieldNextDamage` is a generic effect.

**Rejected, no change:** M1 — "equal shields from two different Poroms are not interchangeable: the shield that survives
names a different source." True, and the only difference is that name: the trace's `by`, the log line and the "kept"
wording. No rule, pool card or AI decision reads a shield's source or its controller (readers: `replacementsFor`'s `by`,
the invariants' existence check, the ISMCTS key by source CODE — which agrees for two copies of the one Porom printing).
Each Porom puts itself in the Break Zone, so two shields on one Forward almost always come from two different copies;
keying by source would restore the very prompt the decision removes. Revisit if a card ever reads who controls a
replacement effect: add the source's controller to the key.
