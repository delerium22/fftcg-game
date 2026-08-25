import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type CardDef, type Event } from '@fftcg/engine'
import { describeCommand, renderView } from './render.js'

export interface HotseatIo {
  ask(prompt: string): Promise<string>
  print(line: string): void
  clear(): void
}

function describeEvent(e: Event): string | null {
  switch (e.type) {
    case 'unimplementedAbility': return `  ! ${e.code} has abilities that are not implemented yet (played as vanilla)`
    case 'exBurstSkipped': return `  ! EX Burst on damage card #${e.card} skipped (not implemented)`
    case 'playerDamaged': return `  P${e.player} takes 1 damage`
    case 'broken': return `  #${e.card} is broken`
    case 'battleDamage': return `  #${e.source} deals ${e.amount} to #${e.target}`
    case 'gameOver': return `  GAME OVER`
    default: return null
  }
}

export async function hotseat(opts: { seed: number; decks: [string[], string[]]; defs: CardDef[] }, io?: HotseatIo): Promise<void> {
  const rl = io ? null : createInterface({ input: stdin, output: stdout })
  const realIo: HotseatIo = { ask: (p) => rl!.question(p), print: (l) => console.log(l), clear: () => console.clear() }
  const term = io ?? realIo
  let s = createGame(opts)
  let lastPlayer: number | null = null
  while (!s.result) {
    const p = actingPlayer(s)!
    if (p !== lastPlayer) {
      // pass-device barrier: never leave the previous player's hand on screen
      if (lastPlayer !== null) { term.clear(); await term.ask(`Pass the device to P${p} and press Enter... `) }
      term.clear()
      lastPlayer = p
    }
    const view = viewFor(s, p)
    const legal = legalCommands(s, p)
    const nonConcede = legal.filter((c) => c.type !== 'concede')
    term.print('\n' + renderView(view))
    let choice
    if (nonConcede.length === 1 && nonConcede[0]?.type === 'pass') {
      choice = nonConcede[0]; term.print('(auto-pass: nothing else to do)')
    } else {
      legal.forEach((c, i) => term.print(`  ${i}: ${describeCommand(view, c)}`))
      for (;;) {
        const answer = await term.ask(`P${p}> `)
        const i = Number(answer)
        if (Number.isInteger(i) && legal[i]) { choice = legal[i]; break }
        term.print('enter a number from the list')
      }
    }
    const r = apply(s, choice!)
    s = r.state
    for (const e of r.events) { const line = describeEvent(e); if (line) term.print(line) }
  }
  term.clear()
  term.print(renderView(viewFor(s, 0)))
  rl?.close()
}
