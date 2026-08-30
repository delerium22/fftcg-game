import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { GreedyAgent, IsmctsAgent, RandomAgent } from '@fftcg/ai'
import { loadCards } from '@fftcg/cards'
import { actingPlayer, apply, createGame, legalCommands, viewFor } from '@fftcg/engine'
import type { Agent } from '@fftcg/ai'
import { parseDeckFile } from '../src/deck.js'
import { MAX_ITERATIONS, MAX_ROLLOUT_CAP, describeAgentSpec, makeAgent, parseAgentSpec, parseDepth, parseWeightOverrides, withDefaults, parseIterations, parsePositiveInt, parseRolloutCap, type AgentSpec } from '../src/agents.js'
import { selfPlay } from '../src/selfplay.js'
import { mirrorTournament } from '../src/mirror.js'

const deck = (): string[] => parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
const decks = (): [string[], string[]] => { const d = deck(); return [d, d] }

describe('parseAgentSpec', () => {
  it('accepts random', () => { expect(parseAgentSpec('random')).toEqual({ kind: 'random' }) })
  it('accepts greedy with no depth', () => { expect(parseAgentSpec('greedy')).toEqual({ kind: 'greedy' }) })
  it('accepts greedy:0', () => { expect(parseAgentSpec('greedy:0')).toEqual({ kind: 'greedy', depth: 0 }) })
  it('accepts greedy:2', () => { expect(parseAgentSpec('greedy:2')).toEqual({ kind: 'greedy', depth: 2 }) })
  it('throws on greedy:3', () => { expect(() => parseAgentSpec('greedy:3')).toThrow() })
  it('throws on unknown spec', () => { expect(() => parseAgentSpec('foo')).toThrow() })

  // D1
  it('accepts ismcts with no iteration count', () => { expect(parseAgentSpec('ismcts')).toEqual({ kind: 'ismcts' }) })
  it('accepts ismcts:1', () => { expect(parseAgentSpec('ismcts:1')).toEqual({ kind: 'ismcts', iterations: 1 }) })
  it('accepts ismcts:1000', () => { expect(parseAgentSpec('ismcts:1000')).toEqual({ kind: 'ismcts', iterations: 1000 }) })
  it('accepts ismcts at the cap', () => { expect(parseAgentSpec(`ismcts:${MAX_ITERATIONS}`)).toEqual({ kind: 'ismcts', iterations: MAX_ITERATIONS }) })
  it('throws on every malformed iteration count', () => {
    // Each of these is a value `Number()` would have accepted (or silently turned into NaN) had the parser used
    // it: 0 iterations searches nothing, and '1e3'/' 1'/'0x10' are typos, not budgets.
    for (const bad of ['ismcts:0', 'ismcts:-1', 'ismcts:1.5', 'ismcts:1e3', 'ismcts:0x10', 'ismcts:abc', 'ismcts:', 'ismcts:01', 'ismcts: 1', 'ismcts:1 ', `ismcts:${MAX_ITERATIONS + 1}`]) {
      expect(() => parseAgentSpec(bad), bad).toThrow()
    }
  })
  it('throws on a spec that only looks like ismcts', () => {
    for (const bad of ['ISMCTS', 'ismcts2', 'ismcts::1', ' ismcts']) expect(() => parseAgentSpec(bad), bad).toThrow()
  })
})

describe('C7: parseDepth (shared by greedy:N and --depth)', () => {
  it('accepts 0, 1, 2', () => {
    expect(parseDepth('0')).toBe(0)
    expect(parseDepth('1')).toBe(1)
    expect(parseDepth('2')).toBe(2)
  })
  it('throws on out-of-range, non-integer, or malformed input', () => {
    for (const bad of ['3', '-1', '1.5', 'abc', '', '01', ' 1']) expect(() => parseDepth(bad)).toThrow()
  })
})

describe('D1: parsePositiveInt (shared by ismcts:N, --iterations, --pairs, --games, --bootstrap)', () => {
  it('accepts positive integers up to the cap', () => {
    expect(parsePositiveInt('1', 'x', 10)).toBe(1)
    expect(parsePositiveInt('10', 'x', 10)).toBe(10)
  })
  it('rejects zero, negatives, decimals, exponents, hex, padding and blanks', () => {
    for (const bad of ['0', '-1', '1.5', '1e3', '0x10', '+1', '01', ' 1', '1 ', '', 'abc', 'Infinity', 'NaN']) {
      expect(() => parsePositiveInt(bad, 'x', 10), bad).toThrow()
    }
  })
  it('rejects above the cap and names what was wrong', () => {
    expect(() => parsePositiveInt('11', 'iterations', 10)).toThrow(/iterations/)
  })
  it('parseIterations applies the shared cap', () => {
    expect(parseIterations('500')).toBe(500)
    expect(() => parseIterations(String(MAX_ITERATIONS + 1))).toThrow()
  })
})

describe('the rollout cap is a measurable dial (spec D5)', () => {
  it('parseRolloutCap validates like every other unbounded flag', () => {
    expect(parseRolloutCap('12')).toBe(12)
    expect(() => parseRolloutCap('0')).toThrow()
    expect(() => parseRolloutCap('1.5')).toThrow()
    expect(() => parseRolloutCap(' 8')).toThrow()
    expect(() => parseRolloutCap(String(MAX_ROLLOUT_CAP + 1))).toThrow()
  })

  it('is part of the agent LABEL, so a tournament says which cap produced its number', () => {
    // Without this, two runs at different caps report the same `agents` field and the measurements cannot
    // be told apart afterwards — which makes them useless for comparing against each other.
    expect(describeAgentSpec({ kind: 'ismcts', iterations: 200, rolloutCap: 6 })).toBe('ismcts:200/cap6')
    expect(describeAgentSpec({ kind: 'ismcts', iterations: 200 })).toBe('ismcts:200')
  })

  it('actually reaches the search, and a smaller cap does less rollout work', () => {
    // The label and the parser can both be right while the value never reaches `searchIsmcts`. The only
    // proof that it does is the work actually falling, which `rolloutApplies` counts.
    const d = decks()
    const work = (cap: number | undefined): number => {
      const spec: AgentSpec = cap === undefined
        ? { kind: 'ismcts', iterations: 30 }
        : { kind: 'ismcts', iterations: 30, rolloutCap: cap }
      const agent = makeAgent(spec, 1, d) as IsmctsAgent
      let s = createGame({ seed: 5, decks: d, defs: loadCards() })
      const p = actingPlayer(s) as 0 | 1
      s = apply(s, { type: 'chooseFirst', player: p, goFirst: true }).state
      // Mulligan order follows whoever is asked; taking it from the state avoids "player 0 is not acting".
      for (let i = 0; i < 2; i++) {
        const m = actingPlayer(s) as 0 | 1
        s = apply(s, { type: 'mulligan', player: m, redraw: false }).state
      }
      const actor = actingPlayer(s) as 0 | 1
      agent.decide(viewFor(s, actor), legalCommands(s, actor))
      return agent.lastDiagnostics?.rolloutApplies ?? -1
    }
    const wide = work(undefined)
    const narrow = work(2)
    expect(wide, 'no rollout work was recorded — the probe measures nothing').toBeGreaterThan(0)
    expect(narrow, 'a smaller cap did not reduce rollout work, so the flag never reaches the search').toBeLessThan(wide)
  })
})

describe('describeAgentSpec', () => {
  it('round-trips random', () => { expect(describeAgentSpec(parseAgentSpec('random'))).toBe('random') })
  it('round-trips bare greedy', () => { expect(describeAgentSpec(parseAgentSpec('greedy'))).toBe('greedy') })
  it('round-trips greedy:0', () => { expect(describeAgentSpec(parseAgentSpec('greedy:0'))).toBe('greedy:0') })
  it('round-trips greedy:2', () => { expect(describeAgentSpec(parseAgentSpec('greedy:2'))).toBe('greedy:2') })
  it('round-trips bare ismcts', () => { expect(describeAgentSpec(parseAgentSpec('ismcts'))).toBe('ismcts') })
  it('round-trips ismcts:250', () => { expect(describeAgentSpec(parseAgentSpec('ismcts:250'))).toBe('ismcts:250') })
})

describe('makeAgent', () => {
  it('builds a RandomAgent for a random spec', () => {
    const agent = makeAgent({ kind: 'random' }, 1, [['A-1'], ['A-1']])
    expect(agent).toBeInstanceOf(RandomAgent)
    expect(agent.needsLegalCommands).toBe(true)
  })
  it('builds a GreedyAgent for a greedy spec with needsLegalCommands false', () => {
    const agent = makeAgent({ kind: 'greedy', depth: 2 }, 1, [['A-1'], ['A-1']])
    expect(agent).toBeInstanceOf(GreedyAgent)
    expect(agent.needsLegalCommands).toBe(false)
  })
  it('builds a GreedyAgent without an explicit depth', () => {
    const agent = makeAgent({ kind: 'greedy' }, 1, [['A-1'], ['A-1']])
    expect(agent).toBeInstanceOf(GreedyAgent)
  })
  it('D1: builds an IsmctsAgent, with and without an explicit iteration count', () => {
    expect(makeAgent({ kind: 'ismcts' }, 1, [['A-1'], ['A-1']])).toBeInstanceOf(IsmctsAgent)
    expect(makeAgent({ kind: 'ismcts', iterations: 16 }, 1, [['A-1'], ['A-1']])).toBeInstanceOf(IsmctsAgent)
  })
})

describe('selfPlay determinism', () => {
  it('two identical runs produce identical reports (ignoring timing)', () => {
    const deck = parseDeckFile(readFileSync(new URL('../../../decks/starter-2025-vol2.txt', import.meta.url), 'utf8'))
    const opts = { games: 5, seed: 900, decks: [deck, deck] as [string[], string[]], defs: loadCards(), agents: [{ kind: 'greedy' as const }, { kind: 'random' as const }] as [AgentSpec, AgentSpec], strict: false }
    const r1 = selfPlay(opts)
    const r2 = selfPlay(opts)
    // timing is inherently non-deterministic (wall clock); neutralize it before comparing the rest of the report
    const strip = (r: typeof r1) => ({ ...r, msPerDecision: [0, 0] as [number, number] })
    expect(strip(r1)).toEqual(strip(r2))
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Rung C3 — the agents must actually USE activated abilities
// ---------------------------------------------------------------------------

describe('activated abilities reach the agents (C3-A1)', () => {
  // Being legal is not enough. `candidateCommands` hand-builds the list both agents search, so a command that
  // exists only in `legalCommands` is invisible to them — the plan review caught exactly that, and this is the
  // test that would have failed. It asserts the agents CHOOSE an activation over a real sweep, not merely that
  // one was offered.
  const chosen = new Map<string, number>()
  for (let seed = 1; seed <= 40 && chosen.size === 0; seed++) {
    const d = decks()
    const defs = loadCards()
    const agents: [Agent, Agent] = [
      new GreedyAgent({ seed, decks: d, depth: 1 }),
      new GreedyAgent({ seed: seed + 1000, decks: d, depth: 1 }),
    ]
    let s = createGame({ seed, decks: d, defs })
    for (let i = 0; i < 800 && !s.result; i++) {
      const p = actingPlayer(s)
      if (p === null) break
      const command = agents[p].decide(viewFor(s, p), legalCommands(s, p))
      if (command.type === 'activateAbility') chosen.set(command.abilityId, (chosen.get(command.abilityId) ?? 0) + 1)
      s = apply(s, command).state
    }
  }

  it('greedy chooses an activation at least once across the sweep', () => {
    expect(chosen.size, 'no agent ever used an activated ability — they are legal but unreachable').toBeGreaterThan(0)
  })

  it('every activation it chose is a real activated clause', () => {
    // Grows as rungs land: C3 shipped six, C7 added Undead Princess's removal. The point of the assertion is
    // that the agent never invents an id, not that the list is frozen at six.
    const ACTIVATED = [
      '1-121C:haste', '16-092C:dull-all', '18-064C:draw', '18-069C:draw',
      '19-052C:pump', '19-052C:remove', '20-074C:draw',
    ]
    for (const id of chosen.keys()) expect(ACTIVATED).toContain(id)
  })
})

describe('weight overrides on an ISMCTS arm (G1a)', () => {
  it('parses `ismcts:N+name=value` and keeps the iteration count', () => {
    expect(parseAgentSpec('ismcts:200+damage=8'))
      .toEqual({ kind: 'ismcts', iterations: 200, weights: { damage: 8 } })
    expect(parseAgentSpec('ismcts+damage=25')).toEqual({ kind: 'ismcts', weights: { damage: 25 } })
    expect(parseAgentSpec('ismcts:200+damage=25,threat=0.9'))
      .toEqual({ kind: 'ismcts', iterations: 200, weights: { damage: 25, threat: 0.9 } })
  })

  it('takes decimals and negatives, which are both real weight values', () => {
    expect(parseWeightOverrides('handQuality=0.5')).toEqual({ handQuality: 0.5 })
    expect(parseWeightOverrides('expiredThreat=-1.5')).toEqual({ expiredThreat: -1.5 })
  })

  it('refuses what `Number()` would silently accept, because a coerced weight reads as a strength difference', () => {
    for (const bad of ['damage= 1', 'damage=1e3', 'damage=0x10', 'damage=', 'damage=1.', 'damage=+1', 'damage=01']) {
      expect(() => parseWeightOverrides(bad), `"${bad}" was accepted`).toThrow(/invalid weight override/)
    }
  })

  it('refuses an unknown weight at the FLAG, not silently at runtime', () => {
    // The failure this prevents: `damagee` overrides nothing, so the arm runs the CONTROL's policy while the
    // report names it as the treatment. That is an A/B reporting one arm twice under two names.
    expect(() => parseAgentSpec('ismcts:200+damagee=8')).toThrow(/unknown weight "damagee"/)
    expect(() => parseWeightOverrides('damage=1,damage=2')).toThrow(/given twice/)
    expect(() => parseAgentSpec('ismcts:200+')).toThrow(/invalid weight override/)
  })

  it('reports the ITERATIONS as bad when the iterations are bad, not the whole spec', () => {
    // The suffix is split off first precisely so this error names the half that is actually wrong.
    expect(() => parseAgentSpec('ismcts:0+damage=1')).toThrow(/invalid iterations "0"/)
  })

  it('names the weights in the agent description, so an arm is not reported as its own control', () => {
    const spec = parseAgentSpec('ismcts:200+threat=0.9,damage=25')
    expect(describeAgentSpec(spec)).toBe('ismcts:200+damage=25,threat=0.9')
    // Sorted, so one arm carries ONE name however the flag was typed.
    expect(describeAgentSpec(parseAgentSpec('ismcts:200+damage=25,threat=0.9'))).toBe(describeAgentSpec(spec))
    expect(describeAgentSpec(parseAgentSpec('ismcts:200'))).toBe('ismcts:200')
  })

  it('builds an agent that carries them — a description alone would be a label on nothing', () => {
    const d = decks()
    const s = createGame({ seed: 3, decks: d, defs: loadCards() })
    const p = actingPlayer(s) ?? 0
    expect(() => makeAgent(parseAgentSpec('ismcts:20+damage=25'), 1, d).decide(viewFor(s, p), legalCommands(s, p)))
      .not.toThrow()
    // And a poisoned weight fails loudly rather than playing badly in silence.
    expect(() => makeAgent({ kind: 'ismcts', iterations: 20, weights: { damage: NaN } }, 1, d)
      .decide(viewFor(s, p), legalCommands(s, p))).toThrow(/every score NaN/)
  })
})

describe('the flag reaches the tournament (G1a, and the bug an A/A caught)', () => {
  // `withDefaults` used to REBUILD the ismcts spec field by field, so it silently dropped every field its own
  // list forgot — and `weights` was one. `--a ismcts:200+damage=25` therefore reached the tournament as plain
  // `ismcts:200`: the treatment arm ran the CONTROL's policy while the report named it as the treatment.
  //
  // Nothing caught it. `parseAgentSpec` was tested, `describeAgentSpec` was tested, `makeAgent` was tested —
  // and the defect lived in the one link between them that no test composed. It surfaced only because an
  // accidental A/A run printed `"agents": ["ismcts:200", "ismcts:200"]` for two arms that were meant to
  // differ. So the assertion here is on the COMPOSITION the CLI actually performs, not on its parts.
  const cliArm = (flagValue: string): string =>
    describeAgentSpec(withDefaults(parseAgentSpec(flagValue), 1, 200, null, null))

  it('carries weights from the flag string all the way to the reported agent name', () => {
    expect(cliArm('ismcts:200+damage=25')).toBe('ismcts:200+damage=25')
    expect(cliArm('ismcts+damage=25')).toBe('ismcts:200+damage=25')
    expect(cliArm('ismcts:200+damage=25,threat=0.9')).toBe('ismcts:200+damage=25,threat=0.9')
  })

  it('leaves a treatment arm DISTINGUISHABLE from its control, which is the whole point', () => {
    expect(cliArm('ismcts:200+damage=25')).not.toBe(cliArm('ismcts:200'))
  })

  it('still applies the defaults it exists to apply, and still lets an explicit suffix win', () => {
    expect(cliArm('ismcts')).toBe('ismcts:200')
    expect(cliArm('ismcts:40')).toBe('ismcts:40')
    expect(describeAgentSpec(withDefaults(parseAgentSpec('greedy'), 2, 200, null, null))).toBe('greedy:2')
    expect(describeAgentSpec(withDefaults(parseAgentSpec('greedy:0'), 2, 200, null, null))).toBe('greedy:0')
    expect(describeAgentSpec(withDefaults(parseAgentSpec('random'), 2, 200, null, null))).toBe('random')
  })

  it('carries the cap and the box alongside the weights rather than instead of them', () => {
    const spec = withDefaults(parseAgentSpec('ismcts:200+damage=25'), 1, 200, 40, { ms: 500, minIterations: 64 })
    expect(describeAgentSpec(spec)).toBe('ismcts:200/cap40/box500ms+min64+damage=25')
    expect(spec).toMatchObject({ kind: 'ismcts', iterations: 200, rolloutCap: 40, budgetMs: 500, minIterations: 64, weights: { damage: 25 } })
  })

  it('the tournament REPORT names the weight, which is where the bug was visible', () => {
    // A one-iteration tournament, because this asserts labelling rather than play: what went wrong was that
    // both arms printed `"agents": ["ismcts:200", "ismcts:200"]`, and a report that cannot tell its treatment
    // from its control is a measurement nobody can act on however the games came out.
    const common = { pairs: 1, seed: 700, decks: decks(), defs: loadCards(), strict: false, bootstrapSamples: 50 }
    const control = mirrorTournament({ ...common, agents: [parseAgentSpec('ismcts:1'), parseAgentSpec('greedy:1')] })
    const treated = mirrorTournament({ ...common, agents: [parseAgentSpec('ismcts:1+damage=25'), parseAgentSpec('greedy:1')] })
    expect(treated.agents[0]).toBe('ismcts:1+damage=25')
    expect(control.agents[0]).toBe('ismcts:1')
    expect(treated.search[0]?.decisions ?? 0, 'the arm never searched, so nothing is proven').toBeGreaterThan(0)
  })

  it('an agent BUILT through the CLI path plays differently under a dominating weight', () => {
    // The behavioural half, entered where the CLI enters it — `parseAgentSpec` -> `withDefaults` ->
    // `makeAgent` -> `decide` — rather than by constructing a SearchInput directly. Deliberately not asserted
    // through `mirrorTournament`: at a test-affordable iteration count the tournament's outcomes coincide
    // whether or not the weight lands, so it would pass for the wrong reason. One decision at twenty
    // iterations is enough to show the override reaches the rollouts through this route.
    const d = decks()
    const s = createGame({ seed: 5, decks: d, defs: loadCards() })
    const p = actingPlayer(s) ?? 0
    const build = (spec: string): AgentSpec => withDefaults(parseAgentSpec(spec), 1, 20, null, null)
    const decide = (spec: string) => makeAgent(build(spec), 7, d).decide(viewFor(s, p), legalCommands(s, p))
    const differed = [1, 2, 3, 4, 5, 6].filter((it) =>
      JSON.stringify(decide(`ismcts:${it * 8}`)) !== JSON.stringify(decide(`ismcts:${it * 8}+damage=4000,forwardPower=-60`)))
    expect(differed.length, 'no iteration count changed its command — the CLI path drops the weight')
      .toBeGreaterThan(0)
  })
})
