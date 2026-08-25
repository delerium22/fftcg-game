import { createGame, type CardDef } from '@fftcg/engine'

export function deckOrder(opts: { seed: number; decks: [string[], string[]]; defs: CardDef[] }): string {
  const s = createGame(opts)
  const lines: string[] = []
  for (const p of [0, 1] as const) {
    lines.push(`Player ${p} deck (top first), seed ${opts.seed}:`)
    s.players[p].deck.forEach((id, i) => { const d = s.defs[s.cards[id]!.code]!; lines.push(`  ${String(i + 1).padStart(2)}. ${d.name} (${d.code})`) })
  }
  return lines.join('\n')
}
