import { readFileSync } from 'node:fs'
import { actingPlayer, apply, createGame, legalCommands, viewFor } from '@fftcg/engine'
import { GreedyAgent, IsmctsAgent } from '@fftcg/ai'
import { loadCards, parseDeckFile } from '@fftcg/cards'
const deck = parseDeckFile(readFileSync(new URL('../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const defs = loadCards()
let s = createGame({ seed: 1, decks: [deck, deck], defs })
const agents = [new IsmctsAgent({ seed: 1, decks: [deck, deck], iterations: 200 }), new GreedyAgent({ seed: 1, decks: [deck, deck], depth: 1 })]
const t0 = performance.now()
let slow = 0
for (let i = 0; i < 6000 && !s.result; i++) {
  const p = actingPlayer(s)!; const legal = legalCommands(s, p)
  const t = performance.now()
  const c = agents[p]!.decide(viewFor(s, p), legal)
  const dt = performance.now() - t
  if (dt > 2000) { slow++; console.log(`SLOW ${dt.toFixed(0)}ms step ${i} p${p} turn ${s.turn} ${s.phase}/${s.attack?.step ?? ''} pending=${s.pending?.kind ?? ''} stack=${s.stack.length} legal=${legal.length} chose=${c.type}`) }
  if (i % 100 === 0) console.log(`step ${i} turn ${s.turn} ${((performance.now() - t0) / 1000).toFixed(0)}s`)
  s = apply(s, c).state
}
console.log(`END turn ${s.turn} result=${JSON.stringify(s.result)} ${((performance.now() - t0) / 1000).toFixed(0)}s slow=${slow}`)
