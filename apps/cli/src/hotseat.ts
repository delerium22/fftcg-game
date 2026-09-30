import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { actingPlayer, apply, createGame, legalCommands, viewFor, type CardDef, type DamageTraceStep, type Event, type PlayerView } from '@fftcg/engine'
import { askingBecause, describeCommand, eventCardName, renderView } from './render.js'

export interface HotseatIo {
  ask(prompt: string): Promise<string>
  print(line: string): void
  clear(): void
}

/**
 * One line of what just happened, with cards NAMED.
 *
 * They used to be raw instance ids — "#9 deals 10000 to #51", then "#51 is broken" — so following a fight
 * meant cross-referencing the board, and once a card was broken it had left the board and there was nothing
 * left to look up. Found by playing; the browser had the same complaint about mirror trades and was fixed
 * for it, and this is the other front-end.
 *
 * `eventCardName` falls back to `#id` for anything outside the view, so a card this player cannot see stays
 * a number rather than leaking its name.
 */
export function describeEvent(v: PlayerView, e: Event): string | null {
  switch (e.type) {
    case 'unimplementedAbility': return `  ! ${e.code} has abilities that are not implemented yet (played as vanilla)`
    case 'exBurstOffered': return `  EX Burst revealed on ${eventCardName(v, e.card)} — P${e.player} may use it`
    case 'exBurstUsed': return `  P${e.player} uses the EX Burst on ${eventCardName(v, e.card)}`
    case 'exBurstDeclined': return `  P${e.player} declines the EX Burst on ${eventCardName(v, e.card)}`
    case 'playerDamaged': return `  P${e.player} takes 1 damage`
    case 'broken': return `  ${eventCardName(v, e.card)} is broken`
    // Rung V2-A1: one line per damage packet — a blocked party's damage to its blocker is one total (§15.1.1.9.8).
    case 'battleDamage': return `  ${e.dealers.map((id) => eventCardName(v, id)).join(' and ')} deal${e.dealers.length === 1 ? 's' : ''} ${replaced(e)} to ${eventCardName(v, e.target)}${replacedBy(v, e.trace)}`
    // Worded apart from combat's "deals N to", which the hotseat test reads as the combat line.
    case 'abilityDamage': return `  ${eventCardName(v, e.target)} takes ${replaced(e)} damage from ${eventCardName(v, e.source)}'s ability${replacedBy(v, e.trace)}`
    case 'damageReducedToZero': return `  ${e.dealers.map((id) => eventCardName(v, id)).join(' and ')}'s ${e.original} damage to ${eventCardName(v, e.target)} is reduced to 0${replacedBy(v, e.trace)}`
    // Rung V2-A2 (plan A2-D2): Porom's shield.
    case 'shieldGranted': return `  ${eventCardName(v, e.card)} is shielded: the next damage dealt to it this turn is reduced by ${e.amount}`
    case 'gameOver': return `  GAME OVER`
    default: return null
  }
}

/** Rung V2-A2 (plan A2-D7): "5000 → 4000" when replacement effects changed the amount, the amount alone otherwise. */
function replaced(e: { original: number; amount: number; trace: readonly unknown[] }): string {
  return e.trace.length > 0 ? `${e.original} → ${e.amount}` : `${e.amount}`
}

/** " (by [7] Charlotte)" — the cards whose effects changed the amount, in the order they applied. */
function replacedBy(v: PlayerView, trace: readonly DamageTraceStep[]): string {
  return trace.length > 0 ? ` (by ${trace.map((t) => eventCardName(v, t.by)).join(', then ')})` : ''
}

/**
 * Thrown when input runs out — Ctrl-D, or a piped stdin reaching its end.
 *
 * Without it `rl.question` simply never settles: node reports "Detected unsettled top-level await" and the
 * process exits 13, which is what a player pressing Ctrl-D used to get instead of a quit.
 */
class InputEnded extends Error {}

export async function hotseat(opts: { seed: number; decks: [string[], string[]]; defs: CardDef[]; lbDecks?: [string[], string[]] }, io?: HotseatIo): Promise<void> {
  const rl = io ? null : createInterface({ input: stdin, output: stdout })
  // `question` does not reject on close by itself, so closing has to abort it.
  const ended = new AbortController()
  rl?.on('close', () => { ended.abort() })
  const realIo: HotseatIo = {
    ask: async (p) => {
      try {
        return await rl!.question(p, { signal: ended.signal })
      } catch (e) {
        // ONLY the abort means the input is gone. A blanket catch relabels every readline failure as a tidy
        // "input ended" and exits 0, which would hide a real fault behind a friendly message.
        if (ended.signal.aborted) throw new InputEnded()
        throw e
      }
    },
    print: (l) => console.log(l),
    clear: () => console.clear(),
  }
  const term = io ?? realIo
  let s = createGame(opts)
  let lastPlayer: number | null = null
  try {
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
    // Why this choice is being asked, when an ability raised it. The menu alone names the cards; this names
    // the clause acting on them.
    const because = askingBecause(view)
    if (because !== null) term.print(because)
    let choice
    if (nonConcede.length === 1 && nonConcede[0]?.type === 'pass') {
      choice = nonConcede[0]; term.print('(auto-pass: nothing else to do)')
    } else {
      // Concede LAST, for the reason the browser sorts it last too: `legalCommands` returns it first (it is
      // legal in every position, §2.1), which made it option 0 — the lowest number, and the one a stray
      // keystroke lands on.
      const ordered = [...nonConcede, ...legal.filter((c) => c.type === 'concede')]
      ordered.forEach((c, i) => term.print(`  ${i}: ${describeCommand(view, c)}`))
      for (;;) {
        const answer = (await term.ask(`P${p}> `)).trim()
        // Blank input is REJECTED rather than parsed. `Number('')` is 0, and 0 used to be Concede, so a bare
        // Enter at the prompt ended the game — the single most likely accidental keystroke, and the whole
        // reason this loop now reads the way it does. `Number(' ')` and `Number('\n')` are 0 as well.
        if (answer === '') { term.print('enter a number from the list'); continue }
        const i = Number(answer)
        const picked = Number.isInteger(i) ? ordered[i] : undefined
        if (!picked) { term.print('enter a number from the list'); continue }
        // The one irreversible move in the game asks first, as it does in the browser.
        if (picked.type === 'concede') {
          const yes = (await term.ask('Concede the game? This cannot be undone [y/N] ')).trim().toLowerCase()
          if (yes !== 'y' && yes !== 'yes') { term.print('still playing'); continue }
        }
        choice = picked
        break
      }
    }
    const r = apply(s, choice!)
    s = r.state
    // Named from the post-apply view: a card that has just been broken is in the Break Zone, which is public,
    // so it still resolves — which is the case that mattered.
    const after = viewFor(s, p)
    for (const e of r.events) { const line = describeEvent(after, e); if (line) term.print(line) }
  }
  } catch (e) {
    if (!(e instanceof InputEnded)) throw e
    // Ctrl-C closes the interface too, so this covers an interrupt as well as a real end-of-input; the
    // wording deliberately does not claim to know which.
    term.print('\ninput closed — leaving the game unfinished')
    rl?.close()
    return
  }
  term.clear()
  term.print(renderView(viewFor(s, 0)))
  rl?.close()
}
