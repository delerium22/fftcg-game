import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  actingPlayer, createGame, legalCommands, viewFor,
  type CardId, type Command, type GameState, type PlayerView,
} from '@fftcg/engine'
import { GreedyAgent } from '@fftcg/ai'
import { CARD_DEFS, DECKS } from '../src/deck.js'
import { Board } from '../src/ui/Board.js'
import { buildChoiceSet, choiceName, describeChoice, occurrenceOf, preferredChoices, qualifiedName } from '../src/game/commands.js'
import { stepAi } from '../src/game/useGame.js'
import { AI, HUMAN, type Choice, type GameApi } from '../src/game/types.js'

/**
 * Two cards of the same code, told apart (rung E9).
 *
 * Found by playing: at "discard down to 5" the strip offered "Discard Luso, Shantotto" and "Discard Luso, Hugh
 * Yurg" TWICE each, because the hand held two copies of each and every instance produces its own command. The
 * player saw two identical buttons and could not tell which copy either one acted on.
 *
 * The first plan was to COLLAPSE them as equivalent. The plan review refused it with a counterexample I had
 * missed: `knownBy` is keyed by CardId and survives movement, so after Miner reveals five cards one copy can be
 * known to the opponent and the other not. Discarding the known copy is a real decision about what the opponent
 * still knows you hold. `MINER_ASYMMETRY` below reaches exactly that position by playing, so this is not a
 * hypothetical — collapsing would have silently deleted a live choice.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}

const MINER = '20-074C'   // in this deck three times over; its ETB reveals five cards to BOTH players

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => { root?.unmount() }); host?.remove(); root = null; host = null })

function render(s: GameState): void {
  const v = viewFor(s, HUMAN)
  const api: GameApi = {
    view: v, choices: buildChoiceSet(v, preferredChoices(v, legalCommands(s, HUMAN))), log: [], aiThinking: false,
    choose: (_c: Choice) => {}, restart: () => {},
  }
  if (!root) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  act(() => { root!.render(createElement(Board, { game: api })) })
}

/**
 * Drives both seats until `stop` says the position has been reached.
 *
 * The human's side is deliberately NOT greedy: a greedy human empties its hand every turn, so self-play never
 * once reaches a hand-size discard — measured over thirty seeds, zero. `hold` passes instead of casting, which
 * is what a real player does while deciding, and is how I reached this defect in the browser.
 */
function playUntil(seed: number, human: 'hold' | 'castMiner', stop: (s: GameState) => boolean): GameState | null {
  const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
  const agent = {
    decide(v: PlayerView, legal: Command[]): Command {
      if (v.me !== HUMAN) return greedy.decide(v, legal)
      if (human === 'castMiner') {
        const cast = legal.find((c) => c.type === 'castCharacter' && v.cards[c.card]?.code === MINER)
        if (cast) return cast
      }
      // `legal[0]` is always `concede` (§2.1, always allowed) — taking it ends the game on move one.
      return legal.find((c) => c.type === 'pass') ?? legal.find((c) => c.type !== 'concede') ?? legal[0]!
    },
  }
  let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
  for (let i = 0; i < 4000 && !s.result; i++) {
    if (stop(s)) return s
    if (actingPlayer(s) === null) return null
    s = stepAi(s, agent).state
  }
  return null
}

function search(human: 'hold' | 'castMiner', stop: (s: GameState) => boolean): GameState | null {
  for (let seed = 1; seed <= 12; seed++) {
    const found = playUntil(seed, human, stop)
    if (found) return found
  }
  return null
}

function duplicateCodeIn(hand: readonly CardId[], s: GameState): string | undefined {
  const codes = hand.map((id) => s.cards[id]?.code)
  return codes.find((c, i) => c !== undefined && codes.indexOf(c) !== i)
}

/** A real hand-size discard where the hand holds two of one code. */
let DUPLICATE_DISCARD: GameState | null = null
/** A real position where two same-code hand cards differ in what the OPPONENT knows AND are selectable. */
let MINER_ASYMMETRY: GameState | null = null

/** Two same-code cards in hand that the opponent knows differently — the pair the collapse would have merged. */
function asymmetricPair(s: GameState): [CardId, CardId] | null {
  const hand = s.players[HUMAN].hand
  for (const a of hand) {
    for (const b of hand) {
      if (a === b || s.cards[a]?.code !== s.cards[b]?.code) continue
      if ((s.knownBy[a] ?? 0) !== (s.knownBy[b] ?? 0)) return [a, b]
    }
  }
  return null
}

beforeAll(() => {
  DUPLICATE_DISCARD = search('hold', (s) =>
    s.pending?.kind === 'discardToHandSize' && s.pending.player === HUMAN
    && duplicateCodeIn(s.players[HUMAN].hand, s) !== undefined)

  // The pair must ALSO be selectable, or the test below asserts nothing about selection. A review caught the
  // first version of this fixture stopping at the earliest asymmetric pair — turn 3, no pending, the two cards
  // reachable only as payment, which the UI does not expose as card subjects. So the search now demands a
  // discard pending too, which is where the player actually picks between them. Reachable on seed 1.
  MINER_ASYMMETRY = search('castMiner', (s) =>
    s.pending?.kind === 'discardToHandSize' && s.pending.player === HUMAN
    && asymmetricPair(s) !== null)
})

describe('two cards of the same code', () => {
  it('are numbered, so no two offered buttons read alike (E9-A1)', () => {
    expect(DUPLICATE_DISCARD, 'never reached a duplicate discard, so this asserts nothing').not.toBe(null)
    const s = DUPLICATE_DISCARD!
    const v = viewFor(s, HUMAN)
    const labels = buildChoiceSet(v, legalCommands(s, HUMAN)).all.map((c) => c.label)
    expect(labels.filter((l, i) => labels.indexOf(l) !== i), 'two buttons still read exactly alike').toEqual([])
  })

  it('read as "name (1)" and "name (2)", and unique cards stay bare (E9-A1)', () => {
    const s = DUPLICATE_DISCARD!
    const v = viewFor(s, HUMAN)
    const code = duplicateCodeIn(v.hand, s)!
    const copies = v.hand.filter((id) => v.cards[id]?.code === code)
    expect(copies.length).toBeGreaterThan(1)
    expect(qualifiedName(v, copies[0]!)).toBe(`${v.defs[code]?.name} (1)`)
    expect(qualifiedName(v, copies[1]!)).toBe(`${v.defs[code]?.name} (2)`)
    const unique = v.hand.find((id) => v.hand.filter((o) => v.cards[o]?.code === v.cards[id]?.code).length === 1)
    expect(unique, 'the whole hand is duplicates, so the "leaves unique cards alone" half asserts nothing')
      .not.toBe(undefined)
    expect(qualifiedName(v, unique!), 'a card with no twin was numbered anyway').not.toMatch(/\(\d+\)$/)
  })

  it('number the RENDERED card to match its button (E9-A1)', () => {
    // A disambiguator on the buttons but not on the cards is worse than none: the button names a copy the
    // player cannot find on the board.
    const s = DUPLICATE_DISCARD!
    render(s)
    const v = viewFor(s, HUMAN)
    const code = duplicateCodeIn(v.hand, s)!
    const name = v.defs[code]?.name
    for (const [i, id] of v.hand.filter((c) => v.cards[c]?.code === code).entries()) {
      const cell = document.querySelector<HTMLElement>(`.hand [data-card-id="${id}"]`)
      expect(cell, `copy ${i + 1} is not rendered at all`).not.toBe(null)
      const said = cell!.querySelector('button')?.getAttribute('aria-label') ?? cell!.textContent ?? ''
      expect(said, 'the rendered card does not say which copy it is').toContain(`${name} (${i + 1})`)
    }
  })

  it('keep every instance separately selectable, each mapped to its own id (E9-A2)', () => {
    // The collapse this rung rejected would have removed one copy's clickability, or filed one representative
    // under both ids so clicking the second submitted a command containing the first.
    const s = DUPLICATE_DISCARD!
    const v = viewFor(s, HUMAN)
    const code = duplicateCodeIn(v.hand, s)!
    const set = buildChoiceSet(v, legalCommands(s, HUMAN))
    for (const id of v.hand.filter((c) => v.cards[c]?.code === code)) {
      const forCard = set.byCard.get(id) ?? []
      expect(forCard.length, `copy ${id} offers no choice at all`).toBeGreaterThan(0)
      for (const choice of forCard) {
        const cards = choice.command.type === 'discardToHandSize' ? choice.command.cards : [choice.card]
        expect(cards, `a choice filed under ${id} does not actually involve it`).toContain(id)
      }
    }
  })

  it('offer each copy the same number of engine commands (E9-A4)', () => {
    // `legalCommands` must keep enumerating every instance: `apply` validates independently and the AI searches
    // the full set. Asserted as an exact multiplicity, not as a vague "unchanged".
    const s = DUPLICATE_DISCARD!
    const v = viewFor(s, HUMAN)
    const code = duplicateCodeIn(v.hand, s)!
    const discards = legalCommands(s, HUMAN).filter((c) => c.type === 'discardToHandSize')
    const mentioning = v.hand.filter((id) => v.cards[id]?.code === code).map((id) =>
      discards.filter((c) => c.type === 'discardToHandSize' && c.cards.includes(id)).length)
    expect(mentioning.every((n) => n > 0), 'the engine stopped offering one of the copies').toBe(true)
    expect(new Set(mentioning).size, 'the engine treats the two copies asymmetrically').toBe(1)
  })
})

describe('two DIFFERENT cards that print the same name', () => {
  // The second half of this rung, found the same way as the first — by playing. This deck runs both Red Mages:
  // `1-121C` at two CP and `18-069C` at one, three of each. They are different cards printing one name, so
  // keying the disambiguator on the CODE called each unique and numbered neither, and the strip went on
  // offering two buttons reading "Discard Red Mage" for cards that cost different amounts.
  //
  // The E9-A1 test above passed throughout, because its fixture happened not to hold both. An acceptance
  // criterion that only checks the hand it was handed is not a criterion.
  const RED_MAGE = ['1-121C', '18-069C'] as const

  function handOf(...codes: string[]): PlayerView {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const v = structuredClone(viewFor(s, HUMAN)) as PlayerView
    v.hand = codes.map((code, i) => {
      const id = 900 + i
      v.cards[id] = { id, code, owner: HUMAN }
      v.defs[code] = CARD_DEFS.find((d) => d.code === code)!
      return id
    })
    return v
  }

  it('are the same printed name on two different cards — the premise, checked', () => {
    const [a, b] = RED_MAGE.map((code) => CARD_DEFS.find((d) => d.code === code))
    expect(a, `${RED_MAGE[0]} is not in the pool`).not.toBe(undefined)
    expect(b, `${RED_MAGE[1]} is not in the pool`).not.toBe(undefined)
    expect(a!.name).toBe(b!.name)
    expect(a!.cost, 'the two Red Mages no longer differ, so this case is not what it says').not.toBe(b!.cost)
  })

  it('are numbered apart even though their codes differ', () => {
    const v = handOf(...RED_MAGE)
    const name = v.defs[RED_MAGE[0]]!.name
    expect(qualifiedName(v, 900)).toBe(`${name} (1)`)
    expect(qualifiedName(v, 901)).toBe(`${name} (2)`)
  })

  it('number a mixed hand across BOTH cards, in hand order', () => {
    // Two of one Red Mage and one of the other: three cards, one name, numbers 1..3 in the order they sit.
    const v = handOf(RED_MAGE[0], RED_MAGE[1], RED_MAGE[0])
    const name = v.defs[RED_MAGE[0]]!.name
    expect([900, 901, 902].map((id) => qualifiedName(v, id)))
      .toEqual([`${name} (1)`, `${name} (2)`, `${name} (3)`])
  })

  it('number the RENDERED Red Mages too, so the buttons point at findable cards', () => {
    // The browser confirmed the same-code half of this rung directly (two hand cards reading "Lightning (1)"
    // and "Lightning (2)"), and confirmed a lone Red Mage stays bare. A hand holding BOTH Red Mages did not
    // come up in forty rounds of play, so it is pinned here instead of claimed from a screenshot.
    const v = handOf(...RED_MAGE)
    const api: GameApi = {
      view: v, choices: buildChoiceSet(v, []), log: [], aiThinking: false,
      choose: (_c: Choice) => {}, restart: () => {},
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root!.render(createElement(Board, { game: api })) })

    const name = v.defs[RED_MAGE[0]]!.name
    for (const [i, id] of [900, 901].entries()) {
      const cell = document.querySelector<HTMLElement>(`.hand [data-card-id="${id}"]`)
      expect(cell, `Red Mage ${i + 1} is not rendered`).not.toBe(null)
      const said = cell!.querySelector('button')?.getAttribute('aria-label') ?? cell!.textContent ?? ''
      expect(said, 'the rendered Red Mage does not say which one it is').toContain(`${name} (${i + 1})`)
    }
  })

  it('leave a lone Red Mage bare, even with the other one absent', () => {
    const v = handOf(RED_MAGE[0], '27-124S')
    expect(occurrenceOf(v, 900), 'a card alone under its name was numbered anyway').toBe(null)
  })
})

describe('the Break Zone, which I had left out (E9-A1)', () => {
  // Found by asking where else the rung's claim could fail, after playing had already found one such place.
  // Billy Bob (18-124C, ×2 here) and Prishe (22-068R, ×3) both print "choose 1 Character in your Break Zone",
  // and a Break Zone routinely holds several cards of one name. Excluding the zone left "Target Cloud" offered
  // twice — the exact defect this rung exists to remove.
  /** Cards sitting in the human's Break Zone, which the board renders only as a count. */
  function breakZoneOf(codes: string[]): PlayerView {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const v = structuredClone(viewFor(s, HUMAN)) as PlayerView
    const ids = codes.map((code, i) => {
      const id = 900 + i
      v.cards[id] = { id, code, owner: HUMAN }
      v.defs[code] = CARD_DEFS.find((d) => d.code === code)!
      return id
    })
    v.fields[HUMAN].breakZone = ids
    return v
  }

  it('is targeted by cards that are actually in this deck — the premise, checked', () => {
    const deck = new Set(DECKS[0])
    expect(deck.has('18-124C'), 'Billy Bob is not in this deck, so this case is unreachable').toBe(true)
    expect(deck.has('22-068R'), 'Prishe is not in this deck, so this case is unreachable').toBe(true)
  })

  it('no longer offers two choices reading exactly alike', () => {
    const v = breakZoneOf(['27-124S', '27-124S'])
    const labels = buildChoiceSet(v, [
      { type: 'chooseTargets', player: HUMAN, targets: [900] },
      { type: 'chooseTargets', player: HUMAN, targets: [901] },
    ]).all.map((c) => c.label)
    expect(labels[0], 'two Break Zone choices still read exactly alike').not.toBe(labels[1])
    expect(labels).toEqual([`Target ${v.defs['27-124S']!.name} (1)`, `Target ${v.defs['27-124S']!.name} (2)`])
  })

  it('tells the two Red Mages apart there too, where the cards genuinely differ', () => {
    // Prishe's filter is CHARACTER, so both Red Mages qualify — a choice between a one-CP card and a two-CP
    // card that read identically before this.
    const v = breakZoneOf(['1-121C', '18-069C'])
    const name = v.defs['1-121C']!.name
    expect(choiceName(v, 900)).toBe(`${name} (1)`)
    expect(choiceName(v, 901)).toBe(`${name} (2)`)
  })

  it('is numbered on a BUTTON and never in the LOG', () => {
    // Numbering the Break Zone in narration put "(1)" into the game log: `the AI's Prishe (1) is broken`.
    // That is unverifiable — the reader cannot see the pile, the position refers to an instant that has
    // passed, and a later line about the same card can carry a different number. An existing test caught it,
    // and the rule changed rather than the expectation. The two namers are what keep the halves apart.
    const v = breakZoneOf(['27-124S', '27-124S'])
    const name = v.defs['27-124S']!.name
    expect(choiceName(v, 900), 'a Break Zone button does not say which card it means').toBe(`${name} (1)`)
    expect(qualifiedName(v, 900), 'a Break Zone number leaked into narration').toBe(name)
    expect(occurrenceOf(v, 900), 'the board-facing number should ignore a zone it does not draw').toBe(null)
  })

  it('leaves a lone Break Zone card bare', () => {
    const v = breakZoneOf(['27-124S', '1-121C'])
    expect(choiceName(v, 900), 'a Break Zone card alone under its name was numbered anyway')
      .toBe(v.defs['27-124S']!.name)
  })

  it('does not let a Break Zone card borrow a number from the field', () => {
    // Zone-scoped means zone-scoped: a Cloud in play and a Cloud in the Break Zone are one each, not two.
    const v = breakZoneOf(['27-124S'])
    const code = '27-124S'
    v.cards[950] = { id: 950, code, owner: HUMAN }
    v.fields[HUMAN].forwards = [{
      id: 950, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false,
      granted: [], powerBonus: 0, flags: [], usedThisTurn: [],
    }]
    const name = v.defs['27-124S']!.name
    expect(choiceName(v, 900), 'the Break Zone card was numbered against the field').toBe(name)
    expect(choiceName(v, 950), 'the field card was numbered against the Break Zone').toBe(name)
  })
})

describe('the Miner position that refused the collapse (E9-A2)', () => {
  it('is reachable by playing, not hypothetical', () => {
    expect(MINER_ASYMMETRY, 'never reached the Miner asymmetry, so this rung rests on nothing').not.toBe(null)
  })

  it('holds two same-code hand cards the OPPONENT knows differently', () => {
    // This is the fact that makes the two buttons non-equivalent. Miner's ETB reveals five cards with
    // `audience: 'all'`, so both players learn them; the Backup added to hand keeps its `knownBy` bit while a
    // second copy drawn normally does not. Discarding the known one is a real information choice.
    const s = MINER_ASYMMETRY!
    const pair = asymmetricPair(s)
    expect(pair, 'the fixture does not actually contain an asymmetric pair').not.toBe(null)
    const [a, b] = pair!
    expect(s.cards[a]?.code, 'the pair is not even the same card').toBe(s.cards[b]?.code)
    expect(s.knownBy[a] ?? 0).not.toBe(s.knownBy[b] ?? 0)
  })

  it('numbers those two copies distinctly and maps each label to its own id', () => {
    const s = MINER_ASYMMETRY!
    const v = viewFor(s, HUMAN)
    const [a, b] = asymmetricPair(s)!
    expect(occurrenceOf(v, a), 'a copy in a duplicated pair was not numbered').not.toBe(null)
    expect(occurrenceOf(v, b), 'a copy in a duplicated pair was not numbered').not.toBe(null)
    expect(qualifiedName(v, a), 'the two copies still read alike').not.toBe(qualifiedName(v, b))
    // The number is not decorative: it identifies WHICH id, in hand order.
    const order = v.hand.filter((id) => v.cards[id]?.code === v.cards[a]?.code)
    expect(order[occurrenceOf(v, a)! - 1], 'the number does not point at the card it labels').toBe(a)
    expect(order[occurrenceOf(v, b)! - 1], 'the number does not point at the card it labels').toBe(b)
  })

  it('offers BOTH of them as choices, each carrying its own id (E9-A2, the half I had not tested)', () => {
    // A review caught this test claiming "both selectable" while asserting nothing about selection — its
    // fixture stopped at the first asymmetric pair, a position with no pending at all, where those two cards
    // were reachable only as payment. The fixture now demands a discard pending as well, so the pair really is
    // on offer, and this checks the mapping that the refused collapse would have broken.
    const s = MINER_ASYMMETRY!
    const v = viewFor(s, HUMAN)
    const [a, b] = asymmetricPair(s)!
    const set = buildChoiceSet(v, legalCommands(s, HUMAN))
    for (const id of [a, b]) {
      const forCard = set.byCard.get(id) ?? []
      expect(forCard.length, `the ${id === a ? 'known' : 'unknown'} copy is not selectable at all`)
        .toBeGreaterThan(0)
      for (const choice of forCard) {
        const cards = choice.command.type === 'discardToHandSize' ? choice.command.cards : [choice.card]
        expect(cards, `a choice filed under ${id} does not involve it`).toContain(id)
      }
    }
    // And the two are genuinely distinct choices, not one representative filed twice.
    expect(set.byCard.get(a), 'both ids point at the same choice list').not.toBe(set.byCard.get(b))
  })
})

describe('same-code cards that are mechanically different (E9-A3)', () => {
  it('are numbered too — a damaged Forward is not its twin', () => {
    // The plan review's second counterexample. Two same-code Forwards differ in damage, status and flags, so a
    // target label can read alike while one survives the hit and the other breaks. Hand-built on a real view,
    // because this is about the naming rule and not about how the board got there.
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const v = structuredClone(viewFor(s, HUMAN)) as PlayerView
    const code = '27-124S'                                  // Cloud, a Forward in this deck
    const def = CARD_DEFS.find((d) => d.code === code)!
    const put = (id: CardId, damage: number) => {
      v.cards[id] = { id, code, owner: AI }
      v.defs[code] = def
      return {
        id, status: 'active' as const, damage, enteredTurn: 0, attackedThisTurn: false,
        granted: [], powerBonus: 0, flags: [], usedThisTurn: [],
      }
    }
    v.fields[AI].forwards = [put(901, 0), put(902, 5000)]

    expect(occurrenceOf(v, 901), 'the first copy is not numbered').toBe(1)
    expect(occurrenceOf(v, 902), 'the second copy is not numbered').toBe(2)
    expect(qualifiedName(v, 901)).not.toBe(qualifiedName(v, 902))
  })

  it('still say WHOSE they are when the opponent has one of the same name', () => {
    // Regression found by mutation, not by review: `qualifiedName` decides "your Cloud" vs "Cloud" by looking
    // for that printed name on the OPPONENT's table. Numbering made the name it looked up "Cloud (1)", which
    // matches nothing over there — so the possessive silently vanished at exactly the moment it matters most,
    // two of your Clouds facing one of theirs. The comparison has to use the bare name; the label keeps the
    // number. Nothing in the other 322 tests caught this.
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const v = structuredClone(viewFor(s, HUMAN)) as PlayerView
    const code = '27-124S'
    v.defs[code] = CARD_DEFS.find((d) => d.code === code)!
    const name = v.defs[code]!.name
    const put = (id: CardId, owner: typeof HUMAN | typeof AI) => {
      v.cards[id] = { id, code, owner }
      return {
        id, status: 'active' as const, damage: 0, enteredTurn: 0, attackedThisTurn: false,
        granted: [], powerBonus: 0, flags: [], usedThisTurn: [],
      }
    }
    v.fields[HUMAN].forwards = [put(901, HUMAN), put(902, HUMAN)]
    v.fields[AI].forwards = [put(903, AI)]

    expect(qualifiedName(v, 901)).toBe(`your ${name} (1)`)
    expect(qualifiedName(v, 902)).toBe(`your ${name} (2)`)
    // And the other direction: the AI's lone copy is bare-numbered but still says whose it is.
    expect(qualifiedName(v, 903)).toBe(`the AI's ${name}`)
  })

  it('leave a lone Forward bare', () => {
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const v = structuredClone(viewFor(s, HUMAN)) as PlayerView
    const code = '27-124S'
    v.defs[code] = CARD_DEFS.find((d) => d.code === code)!
    v.cards[901] = { id: 901, code, owner: AI }
    v.fields[AI].forwards = [{
      id: 901, status: 'active', damage: 0, enteredTurn: 0, attackedThisTurn: false,
      granted: [], powerBonus: 0, flags: [], usedThisTurn: [],
    }]
    expect(occurrenceOf(v, 901), 'a Forward with no twin was numbered anyway').toBe(null)
  })
})

/**
 * The three places a Codex review found the rung's claim still failing, after playing had already found two.
 *
 * All three are commands whose distinguishing part is a card the BOARD DOES NOT DRAW — an activation's target,
 * a deck card, a Break Zone card. The rung had been treating "which card does this button act on" as a
 * question about the hand, and it is not.
 */
describe('choices whose subject the board does not draw', () => {
  /** Plays both seats until `stop`, with the human driven by `human`. */
  function drive(seed: number, human: (v: PlayerView, legal: Command[]) => Command | null,
    stop: (s: GameState) => boolean): GameState | null {
    const greedy = new GreedyAgent({ seed, decks: DECKS, depth: 1 })
    const agent = {
      decide(v: PlayerView, legal: Command[]): Command {
        if (v.me !== HUMAN) return greedy.decide(v, legal)
        return human(v, legal) ?? greedy.decide(v, legal)
      },
    }
    let s: GameState = createGame({ seed, decks: DECKS, defs: CARD_DEFS })
    for (let i = 0; i < 3000 && !s.result; i++) {
      if (stop(s)) return s
      if (actingPlayer(s) === null) return null
      s = stepAi(s, agent).state
    }
    return null
  }

  function targetGroups(s: GameState): Map<string, Set<string>> {
    const groups = new Map<string, Set<string>>()
    for (const c of legalCommands(s, HUMAN)) {
      if (c.type !== 'activateAbility') continue
      const k = `${c.source}:${c.abilityId}`
      groups.set(k, (groups.get(k) ?? new Set<string>()).add(JSON.stringify([...c.targets])))
    }
    return groups
  }

  it('an activation keeps ONE BUTTON PER TARGET — the worst thing this rung turned up', () => {
    // `payableKey` was `source:ability`, so `legalCommands`'s one-command-per-target collapsed into a single
    // button and whichever Forward happened to come first was pumped. Silently deciding a live choice for the
    // player is the exact operation this rung's plan review refused — and it was already shipping.
    //
    // Seed 1, ordinary greedy play: Undead Princess's pump has FOUR legal targets.
    const found = drive(1, () => null, (s) =>
      actingPlayer(s) === HUMAN && [...targetGroups(s).values()].some((t) => t.size >= 2))
    expect(found, 'never reached an activation with two legal targets, so this asserts nothing').not.toBe(null)

    const v = viewFor(found!, HUMAN)
    const kept = preferredChoices(v, legalCommands(found!, HUMAN))
    let checked = 0
    for (const [k, targetSets] of targetGroups(found!)) {
      if (targetSets.size < 2) continue
      checked++
      const survivors = kept.filter((c) => c.type === 'activateAbility' && `${c.source}:${c.abilityId}` === k)
      expect(survivors.length, `${k}: ${targetSets.size} targets collapsed to ${survivors.length} button(s)`)
        .toBe(targetSets.size)
      const labels = survivors.map((c) => describeChoice(v, c))
      expect(labels.filter((l, i) => labels.indexOf(l) !== i), `${k}: two target buttons read alike`).toEqual([])
    }
    expect(checked, 'the fixture held no multi-target activation after all').toBeGreaterThan(0)
  })

  it('a deck search names WHICH copy it found', () => {
    // Hugh Yurg searches the whole deck; this deck runs three Lusos and two Undead Princesses, so five legal
    // commands were rendered under two labels. Reported against seed 2, and reached here by playing.
    const hughYurg = '24-063H'
    const found = drive(2,
      (v, legal) => legal.find((c) => c.type === 'castCharacter' && v.cards[c.card]?.code === hughYurg)
        ?? legal.find((c) => c.type === 'pass') ?? null,
      (s) => s.pending?.kind === 'chooseFromDeck' && s.pending.player === HUMAN)
    expect(found, 'never reached a deck search, so this asserts nothing').not.toBe(null)

    const v = viewFor(found!, HUMAN)
    const labels = buildChoiceSet(v, preferredChoices(v, legalCommands(found!, HUMAN))).all
      .filter((c) => c.command.type === 'chooseFromDeck').map((c) => c.label)
    expect(labels.length, 'the search offered nothing to choose between').toBeGreaterThan(2)
    expect(labels.filter((l, i) => labels.indexOf(l) !== i), 'two search results still read alike').toEqual([])
    expect(labels, 'the duplicated card is not numbered').toContain('Play Luso (1) onto the field')
    expect(labels).toContain('Play Luso (2) onto the field')
  })

  it('two Break Zone copies of one ability SOURCE offer distinct buttons', () => {
    // Undead Princess's removal ability is usable while IN the Break Zone, so two copies there produced two
    // activations with identical wording. `occurrenceOf` is blind to the Break Zone by design (it would put
    // numbers in the log); `choiceName` is not, which is what tells these two apart.
    const s = createGame({ seed: 1, decks: DECKS, defs: CARD_DEFS })
    const v = structuredClone(viewFor(s, HUMAN)) as PlayerView
    const code = '19-052C'
    v.defs[code] = CARD_DEFS.find((d) => d.code === code)!
    v.cards[900] = { id: 900, code, owner: HUMAN }
    v.cards[901] = { id: 901, code, owner: HUMAN }
    v.fields[HUMAN].breakZone = [900, 901]
    const name = v.defs[code]!.name
    expect(choiceName(v, 900)).toBe(`${name} (1)`)
    expect(choiceName(v, 901)).toBe(`${name} (2)`)
    expect(qualifiedName(v, 900), 'the Break Zone number leaked into narration').toBe(name)
  })
})
