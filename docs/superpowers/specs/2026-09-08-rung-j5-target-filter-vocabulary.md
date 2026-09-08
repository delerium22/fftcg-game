# Rung J5 — the target-filter vocabulary, and the card data it reads

> **STATUS: BUILT, 2026-09-08.** The audit's "scaling item for more cards" (ladder J5). Bounded: data fields,
> filter axes, one matcher, one guard test. The user was away; the design calls are mine, recorded here.

## Why

Printed FFTCG text selects cards by **job** ("choose 1 Forward with Job Dragoon"), **category** ("Category
VII"), **name** ("Cloud"), **power** ("power 5000 or less"), **status** ("dull Forward") and **keyword**
("a Forward with Haste") at least as often as by cost or element. `TargetFilter` had type, element and cost
only, and `CardDef` carried no job or category although the fetched data has both. Every card in the next
set that prints one of those words was unrepresentable.

## Design

- **D1 — data.** `CardDef.job?: string` and `CardDef.categories?: readonly string[]` from the SE data's
  `job_en` and `category_1`/`category_2` (`normaliseSeCard`; `assertCardDef` checks the shapes). Optional,
  because the four Starter Vol. 2 exclusives (27-124S..127S) are absent from the endpoint and live in a
  hand-written patch: their job and category are NOT invented — they stay absent, and a pool test names them
  as the only cards allowed to lack the fields. A filter on job/category never matches a card whose value is
  unknown, and the same test is what says which cards those are.
- **D2 — axes, in two homes.** Definition axes (`matchesDefFilter`, what the search's decoder may ask of a
  view): `type`, `types`, `element`, `cost`, `maxCost`, and now `job`, `category` (any of the card's),
  `name`, `keyword` (printed). Instance axes (`matchesFilter`, needs the state): `excludeSource`,
  `excludeSourceName`, `putIntoBreakZoneFromFieldThisTurn`, and now `minPower`/`maxPower` (EFFECTIVE power
  on the field — bonuses count — and printed power off it), `status`, `grantedKeyword` (printed OR granted
  on the field). All axes conjoin.
- **D3 — the lockstep guard.** `FILTER_AXES: Record<keyof TargetFilter, 'def' | 'instance'>` in
  abilities.ts must name every axis, so a new key without a home fails to compile; `target-filters.test.ts`
  exercises every axis by name from that record, so a new axis without a test fails at test time.
- **D4 — display.** The card sheet and the details panel show "job · categories" under the name when
  known, so a player can see what a future "Job Dragoon" filter is reading.

## Acceptance

- **J5-A1** Every fetched card carries a job and at least one category; only 27-124S..127S may lack them.
- **J5-A2** For each axis in `FILTER_AXES`, a def or instance that matches and one that does not, through
  `targetCandidates` on a real state; `matchesDefFilter` agrees with `matchesFilter` on every def-only axis.
- **J5-A3** `maxPower` reads effective power: a 3000 Forward with +4000 fails `maxPower: 5000` on the field
  and passes it in the deck; `grantedKeyword: 'haste'` matches a granted Haste and a printed one.
- **J5-A4** The ISMCTS decoder accepts a deck pick that passes the def axes and rejects one that fails
  `job`.
- **J5-A5** The sheet shows Geomancer as "Standard Unit · XI".
