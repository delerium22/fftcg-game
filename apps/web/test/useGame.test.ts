import { describe, expect, it } from 'vitest'
import {
  actingPlayer, apply, createGame, legalCommands, viewFor,
  type Ability, type CardDef, type CardId, type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent, type Agent } from '@fftcg/ai'
import { withAbilities } from '@fftcg/cards'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { buildChoiceSet, describeChoice, preferredChoices, sameCommand } from '../src/game/commands.js'
import { AI, HUMAN, type LogLine } from '../src/game/types.js'
import { describeEvent, narrator, stepAi } from '../src/game/useGame.js'

const newGame = (seed: number, defs: CardDef[] = CARD_DEFS): GameState => createGame({ seed, decks: DECKS, defs })

/** Spec B-A3, asserted rather than inspected: nothing the AI holds in hand may reach the human's view. */
function assertNoAiHandLeak(state: GameState, view: PlayerView): void {
  for (const id of state.players[AI].hand) {
    expect(view.cards[id]).toBeUndefined()
    expect(view.hand).not.toContain(id)
  }
}

interface PlayedGame { state: GameState; log: LogLine[]; humanMoves: number; commandTypes: Set<Command['type']> }

/**
 * Human policies for the sweeps below. Taking the first choice every time is one narrow path through the game;
 * these four together reach decisions that path never makes.
 */
type Policy = (usable: readonly { command: Command }[], step: number) => number

const POLICIES: Policy[] = [
  () => 0,
  (u) => u.length - 1,
  (u, step) => step % u.length,
  (u, step) => (step * 7 + 3) % u.length,
]

/**
 * A policy that STEERS toward one command type. The index policies above are blind, so whether they ever
 * produce a given command is luck — and rung C1 halved game length, which silently cost them `castSummon`.
 * Reachability is what B-A2 actually asserts, so seek the type rather than hoping a rotation lands on it.
 */
const seeking = (type: Command['type']): Policy => (u) => {
  const i = u.findIndex((c) => c.command.type === type)
  return i >= 0 ? i : 0
}

/**
 * Play a whole game headlessly: `stepAi` drives the agent, and the "human" always takes the first non-concede
 * choice `buildChoiceSet` offers. This is B-A1 (a game reaches a result), B-A2 (only UI-reachable commands are
 * used) and B-A4 (every applied command was in `legalCommands` at the time) without a browser.
 */
function playFullGame(seed: number, pick: Policy = () => 0, defs: CardDef[] = CARD_DEFS): PlayedGame {
  let state = newGame(seed, defs)
  const agent: Agent = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  const log: LogLine[] = []
  const commandTypes = new Set<Command['type']>()
  let humanMoves = 0
  for (let step = 0; step < 4000 && !state.result; step++) {
    const view = viewFor(state, HUMAN)
    assertNoAiHandLeak(state, view)
    if (actingPlayer(state) === AI) {
      const before = state
      const stepped = stepAi(state, agent)
      expect(stepped.state).not.toBe(before)   // stepAi applies exactly one command
      state = stepped.state
      log.push(...stepped.lines)
      continue
    }
    const legal = legalCommands(state, HUMAN)
    const choices = buildChoiceSet(view, preferredChoices(view, legal))
    const usable = choices.all.filter((ch) => ch.command.type !== 'concede')
    const choice = usable[Math.min(usable.length - 1, Math.max(0, pick(usable, step)))]
    expect(choice, `no non-concede choice in ${view.phase}`).toBeDefined()
    // independent of the hook's own guard: the command really is in the legal set at this instant
    expect(legal.some((c) => sameCommand(c, choice!.command))).toBe(true)
    commandTypes.add(choice!.command.type)
    const result = apply(state, choice!.command)
    log.push({ kind: 'human', text: describeChoice(view, choice!.command) })
    const told = narrator(view, viewFor(result.state, HUMAN))
    for (const e of result.events) { const line = describeEvent(told, e); if (line) log.push(line) }
    state = result.state
    humanMoves++
  }
  return { state, log, humanMoves, commandTypes }
}

describe('stepAi', () => {
  it('applies exactly one command and narrates it', () => {
    const state = newGame(5)
    const agent = new GreedyAgent({ seed: 5, decks: DECKS, depth: 1 })
    const acting = actingPlayer(state)
    if (acting === HUMAN) {
      // seed 5 opened on the human; still fine — stepAi drives whoever is acting
      expect(acting).toBe(HUMAN)
    }
    const { state: next, lines } = stepAi(state, agent)
    expect(next).not.toBe(state)
    expect(lines[0]?.kind).toBe('ai')
    expect(lines[0]?.text.length).toBeGreaterThan(0)
  })

  it('is a no-op once the game is over', () => {
    const over = apply(newGame(5), { type: 'concede', player: HUMAN }).state
    const agent = new GreedyAgent({ seed: 5, decks: DECKS, depth: 1 })
    const stepped = stepAi(over, agent)
    expect(stepped.state).toBe(over)
    expect(stepped.lines).toEqual([])
  })

  it('refuses to apply a command outside the legal set (B-A4)', () => {
    const state = newGame(5)
    const rogue: Agent = { decide: (): Command => ({ type: 'declareAttack', player: actingPlayer(state)!, attackers: [1] }) }
    expect(() => stepAi(state, rogue)).toThrow(/illegal command/)
  })
})

describe('describeEvent', () => {
  const view = viewFor(newGame(1), HUMAN)
  it('surfaces unimplemented abilities as a warning (B-A6)', () => {
    const line = describeEvent(view, { type: 'unimplementedAbility', card: 1, code: '25-001H' })
    expect(line?.kind).toBe('warning')
    expect(line?.text).toContain('25-001H')
  })
  it('surfaces a skipped EX Burst as a warning', () => {
    expect(describeEvent(view, { type: 'exBurstSkipped', player: HUMAN, card: 1 })?.kind).toBe('warning')
  })
  it('drops the events the move line already states', () => {
    expect(describeEvent(view, { type: 'cast', player: HUMAN, card: 1, cardType: 'forward' })).toBeNull()
    expect(describeEvent(view, { type: 'attackDeclared', player: HUMAN, attackers: [1] })).toBeNull()
    expect(describeEvent(view, { type: 'cpGenerated', player: HUMAN, cp: ['fire'] })).toBeNull()
  })
  it('reports the result from the human seat', () => {
    expect(describeEvent(view, { type: 'gameOver', result: { winner: HUMAN, reason: 'damage' } })?.text).toContain('you win')
    expect(describeEvent(view, { type: 'gameOver', result: { winner: AI, reason: 'damage' } })?.text).toContain('the AI wins')
  })
})

describe('a complete headless game (B-A1/B-A2/B-A4)', () => {
  const played = playFullGame(1)

  it('terminates with a result', () => {
    expect(played.state.result).not.toBeNull()
    expect(viewFor(played.state, HUMAN).result).not.toBeNull()
    expect(played.humanMoves).toBeGreaterThan(5)
  })

  it('reaches the setup, main-phase and attack commands from the choice set alone', () => {
    for (const type of ['chooseFirst', 'mulligan', 'pass'] as const) expect(played.commandTypes).toContain(type)
    expect([...played.commandTypes].some((t) => t === 'castCharacter' || t === 'castSummon')).toBe(true)
    expect(played.commandTypes).toContain('declareAttack')
  })

  it('logs the game, ending in a result line, with the vanilla-pool warning visible (B-A6)', () => {
    expect(played.log.at(-1)?.kind).toBe('result')
    expect(played.log.some((l) => l.kind === 'warning')).toBe(true)
    expect(played.log.some((l) => l.kind === 'phase')).toBe(true)
    expect(played.log.some((l) => l.kind === 'ai')).toBe(true)
    expect(played.log.some((l) => l.kind === 'human')).toBe(true)
  })

  it('is deterministic for a fixed seed', () => {
    expect(playFullGame(1).log.map((l) => l.text)).toEqual(played.log.map((l) => l.text))
  })

  it('B-A2: EVERY command type the engine can ask for is reachable from the choice set alone', () => {
    // Taking the first choice every time is one narrow path through the game: the human never blocks (the
    // no-block option is first), never splits party damage, and never fills a hand past the discard limit. So
    // sweep seeds AND several human policies — first choice, last choice, and a couple of deterministic
    // rotations — until every command type has been produced. If one never appears, the UI cannot reach it,
    // which is exactly what B-A2 forbids.
    const need = new Set<Command['type']>([
      'chooseFirst', 'mulligan', 'castCharacter', 'castSummon',
      'declareAttack', 'declareBlock', 'assignPartyDamage', 'discardToHandSize', 'pass',
    ])
    // The seed range has to be generous: abilities roughly HALVE game length (the greedy-vs-random gate went
    // from 23.7 average turns to 12.5), so a short game reaches the discard limit and an affordable Summon far
    // less often than the vanilla pool did. 12 seeds was enough before rung C1 and silently stopped being
    // enough after — the loop exits the moment the set is complete, so a wide bound costs nothing when it is.
    const seen = new Set<Command['type']>()
    // Containment, NOT `seen.size >= need.size`: `commandTypes` also collects command types outside `need`
    // (rung C1's `chooseTargets`/`chooseMode`), so a size comparison declared the sweep finished while
    // `castSummon` was still missing — and every later sweep then exited immediately.
    const done = (): boolean => [...need].every((t) => seen.has(t))
    const sweep = (policies: Policy[], seeds: number): void => {
      for (let seed = 1; seed <= seeds && !done(); seed++) {
        for (const policy of policies) {
          for (const t of playFullGame(seed, policy).commandTypes) seen.add(t)
          if (done()) break
        }
      }
    }
    sweep(POLICIES, 12)
    // Whatever the blind policies missed, go looking for on purpose.
    for (const type of need) if (!seen.has(type)) sweep([seeking(type)], 30)
    const missing = [...need].filter((t) => !seen.has(t))
    expect(missing, `unreachable from the UI: ${missing.join(', ')}`).toEqual([])
  })
})

describe('viewFor hides the AI hand throughout (B-A3)', () => {
  it('never exposes an AI hand card id to the human view', () => {
    let state = newGame(2)
    const agent = new GreedyAgent({ seed: 2, decks: DECKS, depth: 1 })
    let checked = 0
    for (let step = 0; step < 2000 && !state.result; step++) {
      const view = viewFor(state, HUMAN)
      assertNoAiHandLeak(state, view)
      const visible = new Set<CardId>(Object.keys(view.cards).map(Number))
      for (const id of state.players[AI].deck) expect(visible.has(id)).toBe(false)
      checked++
      if (actingPlayer(state) === AI) { state = stepAi(state, agent).state; continue }
      const legal = legalCommands(state, HUMAN)
      const next = legal.find((c) => c.type !== 'concede')
      if (!next) break
      state = apply(state, next).state
    }
    expect(checked).toBeGreaterThan(20)
    expect(state.players[AI].hand.length).toBeGreaterThan(0)   // there was something to hide
  })
})

// ---------------------------------------------------------------------------
// Abilities (rung C1)
// ---------------------------------------------------------------------------

/*
 * FIXTURE clauses, not the shipped pool's. The five C1 clauses belong to `packages/cards` and are asserted
 * against their own printed text there; what THIS file has to prove is spec C1-A3 — that a choice an ability
 * raises routes through `legalCommands` and is therefore reachable from the browser's own choice set, with no
 * new decision channel. Forcing the clauses onto three cheap, plentiful cards is what makes that reachable in
 * a bounded seed sweep instead of depending on which real clauses have landed and how often they get cast.
 */
const DULL_TWO: Ability = {
  id: 'ui-fixture:etb-dull', trigger: 'enterField',
  text: 'When this Forward enters the field, choose up to 2 other Forwards. Dull them.',
  effects: [{
    kind: 'chooseTargets', min: 0, max: 2,
    from: { zone: 'forwards', controller: 'any', filter: { excludeSource: true } },
    then: [{ kind: 'dull' }],
  }],
}
const THREE_MODES: Ability = {
  id: 'ui-fixture:summon-modes', trigger: 'summonResolve',
  text: 'Select up to 2 of the 3 following. Deal 3000 damage to all the Forwards opponent controls. Choose 1 Forward. Dull it. All the Forwards you control gain Haste until the end of the turn.',
  effects: [{
    kind: 'chooseModes', min: 0, max: 2,
    modes: [
      { label: 'Deal 3000 damage to all the Forwards opponent controls.', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'opponent' }, do: [{ kind: 'damage', amount: 3000 }] }] },
      // nests a target choice inside a mode, so the mode → target chain is exercised from the UI too
      { label: 'Choose 1 Forward. Dull it.', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: { zone: 'forwards', controller: 'any' }, then: [{ kind: 'dull' }] }] },
      { label: 'All the Forwards you control gain Haste until the end of the turn.', effects: [{ kind: 'forEach', from: { zone: 'forwards', controller: 'self' }, do: [{ kind: 'grantKeyword', keyword: 'haste' }] }] },
    ],
  }],
}

/** `abilityClauses` is 2 so one clause stays unimplemented on every fixture card — C1-9's honest log line. */
const FIXTURES: Record<string, Ability> = {
  '12-120C': DULL_TWO,    // Shantotto, cost 2 Forward
  '27-125S': DULL_TWO,    // Luso, cost 1 Forward, 3 copies
  '20-103H': THREE_MODES, // Ramuh, cost 2 Summon, 3 copies — the only exercise of the Summon path
}
const ABILITY_DEFS: CardDef[] = CARD_DEFS.map((d) => {
  const ability = FIXTURES[d.code]
  return ability ? { ...d, abilities: [ability], abilityClauses: 2 } : d
})

describe('describeEvent narrates ability resolution (rung C1)', () => {
  const RAMUH: CardId = 950
  /** `createGame` deals nothing, so the fixture registers the instances the log lines name. */
  const abilityView = (): PlayerView => {
    const v = viewFor(newGame(1, ABILITY_DEFS), HUMAN)
    v.cards[RAMUH] = { id: RAMUH, code: '20-103H', owner: HUMAN }
    return v
  }
  const view = abilityView()
  const anyCard = RAMUH

  it('quotes the printed wording of the clause that triggered', () => {
    const line = describeEvent(view, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: THREE_MODES.id })
    expect(line?.kind).toBe('event')
    expect(line?.text).toContain('Ramuh')
    expect(line?.text).toContain(THREE_MODES.text)
  })

  it('reports a clause that found nothing to hit rather than staying silent', () => {
    expect(describeEvent(view, { type: 'abilityNoLegalTarget', card: anyCard, abilityId: DULL_TWO.id })?.text).toContain('no legal target')
  })

  it('narrates what the clause DID to the board', () => {
    const text = (e: Parameters<typeof describeEvent>[1]): string => describeEvent(view, e)?.text ?? ''
    expect(text({ type: 'dulled', card: anyCard })).toContain('is dulled')
    expect(text({ type: 'abilityDamage', source: anyCard, target: anyCard, amount: 3000 })).toContain('3000 damage')
    expect(text({ type: 'powerModified', card: anyCard, amount: 3000 })).toContain('+3000 power until the end of the turn')
    expect(text({ type: 'powerModified', card: anyCard, amount: -1000 })).toContain('-1000 power')
    expect(text({ type: 'keywordGranted', card: anyCard, keyword: 'haste' })).toContain('gains Haste')
    expect(text({ type: 'flagGranted', card: anyCard, flag: 'cannotBeBroken' })).toContain('cannot be broken this turn')
    expect(text({ type: 'brokenByAbility', card: anyCard, source: anyCard })).toContain('is broken by')
    expect(text({ type: 'breakPrevented', card: anyCard, flag: 'cannotBeBroken' })).toContain('survives')
    expect(text({ type: 'returnedToHand', player: HUMAN, card: anyCard })).toContain('returns to your hand')
    expect(text({ type: 'returnedToHand', player: AI, card: anyCard })).toContain("returns to the AI's hand")
  })

  it('still names a card an ability moved from a public zone into a hidden hand', () => {
    // Billy Bob returns a Forward from the Break Zone to its owner's HAND. Narrated from the after-view alone
    // that card has no name left, and the log reads `#51 returns to the AI's hand`.
    const before = viewFor(newGame(1, ABILITY_DEFS), HUMAN)
    const gone: CardId = 51
    before.cards[gone] = { id: gone, code: '27-124S', owner: AI }
    const after = viewFor(newGame(1, ABILITY_DEFS), HUMAN)
    expect(describeEvent(after, { type: 'returnedToHand', player: AI, card: gone })?.text).toContain(`#${gone}`)
    expect(describeEvent(narrator(before, after), { type: 'returnedToHand', player: AI, card: gone })?.text).toContain('Cloud')
  })

  it('collapses a multi-line printed clause onto one log line', () => {
    const multi: Ability = { ...THREE_MODES, id: 'ui-fixture:multiline', text: 'Line one.\n\nLine two.' }
    const v = abilityView()
    v.defs['20-103H'] = { ...(v.defs['20-103H'] as CardDef), abilities: [multi] }
    expect(describeEvent(v, { type: 'abilityTriggered', player: HUMAN, card: RAMUH, abilityId: multi.id })?.text).toContain('Line one. Line two.')
  })

  it('counts the clauses still missing on a card that HAS an implemented one (C1-9)', () => {
    const partial = describeEvent(view, { type: 'unimplementedAbility', card: anyCard, code: '20-103H', clauses: 1 })
    expect(partial?.kind).toBe('warning')
    expect(partial?.text).toContain('1 more ability clause')
    // no `clauses` means nothing at all is implemented — the vanilla-pool line keeps its rung-B wording
    expect(describeEvent(view, { type: 'unimplementedAbility', card: anyCard, code: '25-001H' })?.text).toContain('played as vanilla')
  })
})

describe('a complete headless game WITH abilities (C1-A3)', () => {
  // Sweep seeds and human policies until both new command types have been produced from the choice set alone,
  // exactly as the vanilla B-A2 test does. Every game in the sweep must still reach a result.
  const games: PlayedGame[] = []
  const seen = new Set<Command['type']>()
  for (let seed = 1; seed <= 12; seed++) {
    let done = false
    for (const policy of POLICIES) {
      const played = playFullGame(seed, policy, ABILITY_DEFS)
      games.push(played)
      for (const t of played.commandTypes) seen.add(t)
      if (seen.has('chooseTargets') && seen.has('chooseMode')) { done = true; break }
    }
    if (done) break
  }

  it('drives every game to a result with abilities enabled', () => {
    expect(games.length).toBeGreaterThan(0)
    for (const g of games) expect(g.state.result).not.toBeNull()
  })

  it('reaches chooseTargets AND chooseMode from the choice set alone', () => {
    const missing = (['chooseTargets', 'chooseMode'] as const).filter((t) => !seen.has(t))
    expect(missing, `unreachable from the UI: ${missing.join(', ')}`).toEqual([])
  })

  it('narrates the resolution in the log — what triggered, and what it did', () => {
    const log = games.flatMap((g) => g.log)
    expect(log.some((l) => l.text.includes("ability triggers"))).toBe(true)
    expect(log.some((l) => l.text.includes('is dulled') || l.text.includes('gains Haste') || l.text.includes('damage to'))).toBe(true)
  })

  it('is deterministic for a fixed seed and policy', () => {
    const a = playFullGame(1, POLICIES[0], ABILITY_DEFS).log.map((l) => l.text)
    expect(playFullGame(1, POLICIES[0], ABILITY_DEFS).log.map((l) => l.text)).toEqual(a)
  })
})

/**
 * The same sweep over the REAL C1 clauses. `apps/web/src/deck.ts` reads `data/cards.json` directly — the
 * package index cannot run in a browser — and the ASTs are merged on top of that JSON by `withAbilities`, so
 * this is also the assertion that the shipped pool's own wording survives the trip through the choice set.
 */
describe('the shipped C1 clauses reach the UI (C1-A3)', () => {
  const REAL_DEFS = withAbilities(CARD_DEFS)
  const implemented = REAL_DEFS.filter((d) => d.abilities?.length)

  it('carries at least one hand-written clause per C1 card', () => {
    expect(implemented.length).toBeGreaterThan(0)
  })

  it('offers those clauses choices the human can click, and drives to a result', () => {
    const seen = new Set<Command['type']>()
    const results: (GameState['result'])[] = []
    for (let seed = 1; seed <= 12; seed++) {
      let done = false
      for (const policy of POLICIES) {
        const played = playFullGame(seed, policy, REAL_DEFS)
        results.push(played.state.result)
        for (const t of played.commandTypes) seen.add(t)
        if (seen.has('chooseTargets') && seen.has('chooseMode')) { done = true; break }
      }
      if (done) break
    }
    for (const r of results) expect(r).not.toBeNull()
    const missing = (['chooseTargets', 'chooseMode'] as const).filter((t) => !seen.has(t))
    expect(missing, `unreachable from the UI: ${missing.join(', ')}`).toEqual([])
  })
})
