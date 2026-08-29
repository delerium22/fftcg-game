import { describe, expect, it } from 'vitest'
import { effectAtPath, type Effect } from '../src/index.js'

/**
 * `effectAtPath` replaced THREE identical copies of this walk — the engine's private `effectAt`, the
 * browser's `nodeAt` and the AI's own in `candidates.ts`. Each carried a comment explaining why it was
 * duplicating the others, and the one thing all three comments singled out is the case below: `chooseModes`
 * consumes TWO entries of the program counter, not one. That is the step a re-implementation gets wrong,
 * so it is the step pinned here, against hand-written expectations rather than against what the walk returns.
 */

const FROM = { zone: 'forwards', controller: 'any' } as const

// Shantotto's shape: a mode choice whose chosen branch then raises a target choice.
//   [0] chooseModes
//         mode 0 "Deal 4000 damage": [0] chooseTargets -> [0] damage 4000
//         mode 1 "Dull it":          [0] chooseTargets -> [0] dull
//                                                     -> [1] addPower -1000
//   [1] dull
const AST: readonly Effect[] = [
  {
    kind: 'chooseModes', min: 1, max: 1,
    modes: [
      { label: 'Deal 4000 damage', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: FROM, then: [{ kind: 'damage', amount: 4000 }] }] },
      { label: 'Dull it', effects: [{ kind: 'chooseTargets', min: 1, max: 1, from: FROM, then: [{ kind: 'dull' }, { kind: 'addPower', amount: -1000 }] }] },
    ],
  },
  { kind: 'dull' },
]

describe('effectAtPath', () => {
  it('walks into the mode the frame actually chose, not the first one', () => {
    // `modes[0] = 1` means the SECOND mode was chosen. path = [modes node, which-mode slot, inside the mode,
    // inside its `then`] — four entries for three levels of nesting, because chooseModes eats two.
    expect(effectAtPath(AST, [0, 0, 0, 0], [1])).toEqual({ kind: 'dull' })
    expect(effectAtPath(AST, [0, 0, 0, 1], [1])).toEqual({ kind: 'addPower', amount: -1000 })
    // Same path, different chosen mode: the damage branch, so the walk must land somewhere else entirely.
    expect(effectAtPath(AST, [0, 0, 0, 0], [0])).toEqual({ kind: 'damage', amount: 4000 })
  })

  it('stops at the node the counter names, without descending further', () => {
    expect(effectAtPath(AST, [0], [])).toEqual(AST[0])
    expect(effectAtPath(AST, [1], [])).toEqual({ kind: 'dull' })
    // The chooseTargets node itself, one level in — this is the node `targetVerb` reads to label a button.
    expect(effectAtPath(AST, [0, 0, 0], [1])).toMatchObject({ kind: 'chooseTargets', min: 1, max: 1 })
  })

  it('returns null for a counter that does not address a node, rather than guessing', () => {
    expect(effectAtPath(AST, [], [])).toBe(null)              // no counter at all
    expect(effectAtPath(AST, [7], [])).toBe(null)             // past the end
    expect(effectAtPath(AST, [0, 0, 0, 0], [])).toBe(null)    // no mode recorded, so no branch to enter
    expect(effectAtPath(AST, [0, 0, 0, 0], [9])).toBe(null)   // a mode ordinal that does not exist
    expect(effectAtPath(AST, [1, 0], [])).toBe(null)          // `dull` has no children to descend into
    expect(effectAtPath(AST, [0, 0], [1])).toBe(null)         // stops mid-chooseModes: the two levels are one step
  })
})
