/**
 * A/B two evaluation weightings against each other: greedy vs greedy, seats swapped per seed.
 *
 *   pnpm --filter @fftcg/cli exec tsx src/weights-ab.ts [pairs]
 *
 * Why this exists rather than `mirror --a greedy --b greedy`: that pits one weighting against ITSELF. And the
 * ismcts-vs-greedy mirror cannot answer a weights question either, because ISMCTS uses `evaluate` in its own
 * rollouts — changing a weight moves both sides of that matchup at once.
 *
 * Edit `OLD` to whatever you are comparing against. It currently pins the pre-C3 behaviour, where power that
 * expires at end of turn counted at the same rate as printed power.
 *
 * READ THE SAMPLE SIZE BEFORE BELIEVING THE NUMBER. Measuring `temporaryPower` gave 53.3% over 120 games and
 * 50.5% over 800 — the first was noise. A few hundred games is the minimum for a difference this small.
 */
import { readFileSync } from 'node:fs'
import { DEFAULT_WEIGHTS, GreedyAgent } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type GameState, type PlayerId } from '@fftcg/engine'
import { parseDeckFile } from './deck.js'

const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const decks: [string[], string[]] = [deck, deck]
const defs = loadCards()

const NEW = DEFAULT_WEIGHTS
// The old behaviour exactly: a bonus counted at the same rate as printed power.
const OLD = { ...DEFAULT_WEIGHTS, temporaryPower: DEFAULT_WEIGHTS.forwardPower }

const PAIRS = Number(process.argv[2] ?? 60)
let newWins = 0
let oldWins = 0
let draws = 0
let completed = 0

for (let seed = 1; seed <= PAIRS; seed++) {
  for (const newSeat of [0, 1] as const) {
    const agents: [GreedyAgent, GreedyAgent] = [
      new GreedyAgent({ seed, decks, depth: 1, weights: newSeat === 0 ? NEW : OLD }),
      new GreedyAgent({ seed: seed + 5000, decks, depth: 1, weights: newSeat === 1 ? NEW : OLD }),
    ]
    let s: GameState = createGame({ seed, decks, defs })
    let ok = true
    for (let i = 0; i < 2000 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) { ok = false; break }
      s = apply(s, agents[p].decide(viewFor(s, p), legalCommands(s, p))).state
    }
    if (!ok || !s.result) continue
    completed++
    const w = s.result.winner as PlayerId | null
    if (w === null) draws++
    else if (w === newSeat) newWins++
    else oldWins++
  }
}

const rate = completed ? (newWins / completed) * 100 : 0
console.log(JSON.stringify({ pairs: PAIRS, games: completed, newWins, oldWins, draws, newWinRatePct: Number(rate.toFixed(1)) }, null, 2))
