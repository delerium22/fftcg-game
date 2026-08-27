import { describe, expect, it } from 'vitest'
import { canPay, defOf, enumeratePaymentsFor, generateCp, legalCommands } from '@fftcg/engine'
import { preferredPayment, preferredPaymentFor } from '../src/payment.js'
import { VANILLA_POOL, makeDef, makeGame, withField, withHand, withHandSize } from '../../engine/test/helpers.js'

describe('preferredPayment', () => {
  it('dulls matching backups before discarding, and the result satisfies canPay', () => {
    let s = withHandSize(makeGame(), 0, 0); let b1: number, b2: number, card: number
    ;[s, b1] = withField(s, 0, 'backups', 'V-B1')      // earth
    ;[s, b2] = withField(s, 0, 'backups', 'V-B2')      // lightning
    ;[s] = withHand(s, 0, 'V-F8')                       // lightning 9000 — valuable, must not be discarded
    ;[s, card] = withHand(s, 0, 'V-F2')                 // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect([...p.dullBackups].sort()).toEqual([b1, b2].sort()); expect(p.discards).toEqual([])
    expect(canPay(2, ['earth'], generateCp(s, 0, p, card))).toBe(true)
  })
  it('discards the lowest-value cards when backups are insufficient, never the card itself', () => {
    let s = withHandSize(makeGame(), 0, 0); let cheap: number, card: number
    ;[s, cheap] = withHand(s, 0, 'V-S2')                 // earth summon cost 1 — low value
    ;[s] = withHand(s, 0, 'V-F7')                        // earth 8000 — high value
    ;[s, card] = withHand(s, 0, 'V-F2')                  // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect(p.discards.map((d) => d.card)).toEqual([cheap]); expect(p.dullBackups).toEqual([])
  })
  it('R1: picks the lowest-VALUE discard for a required element regardless of hand order', () => {
    // The test above happens to hold the cheap card first, so an implementation that ranks equal-CP sources by
    // hand position still passes it. Both discards supply earth and both generate 2 CP, so only card value can
    // separate them: reversing the hand must not change which one is thrown away.
    for (const order of [['V-S2', 'V-F7'], ['V-F7', 'V-S2']]) {
      let s = withHandSize(makeGame(), 0, 0); let card: number
      for (const code of order) [s] = withHand(s, 0, code)   // V-S2 = earth summon cost 1 (low value), V-F7 = earth 8000 (high)
      ;[s, card] = withHand(s, 0, 'V-F2')                     // earth cost 2
      const p = preferredPayment(s, 0, card)!
      expect(p.discards.map((d) => defOf(s, d.card).code)).toEqual(['V-S2'])
    }
  })
  it('R5: is MINIMAL — never spends a source the payment does not need (Codex counterexample)', () => {
    // Earth cost-2 with one active Earth backup (1 CP) and one cheap Earth discard (2 CP). The required-element
    // phase took the backup (cheapest source for earth), then the top-up phase added the discard to reach 2 CP —
    // spending BOTH for a total of 3 CP, when the discard alone pays exactly. Worse, `enumeratePayments` only
    // emits MINIMAL payments, so this non-minimal result is not in `legalCommands` at all: measured over real
    // games, 40.2% of preferredPayment results were unusable as commands for that reason.
    let s = withHandSize(makeGame(), 0, 0); let card: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')   // earth backup, 1 CP
    ;[s] = withHand(s, 0, 'V-S2')                // earth summon cost 1 — cheap discard, 2 CP
    ;[s, card] = withHand(s, 0, 'V-F2')          // earth cost 2
    const p = preferredPayment(s, 0, card)!
    expect(generateCp(s, 0, p, card)).toHaveLength(2)   // exactly the cost, not 3
    expect(p.dullBackups).toEqual([])                    // the backup stays active
    expect(p.discards).toHaveLength(1)
  })
  it('R5: every preferredPayment result is among the minimal payments legalCommands offers', () => {
    // The property that makes preferredPayment usable as a UI/AI move generator at all: whatever it returns must
    // be a command the engine would list. Checked across fixtures that exercise backups-only, discards-only,
    // mixed, and multi-element costs.
    const fixtures: (() => [ReturnType<typeof makeGame>, number])[] = [
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withField(s, 0, 'backups', 'V-B3'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withHand(s, 0, 'V-S2'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withHand(s, 0, 'V-S2'); ;[s] = withHand(s, 0, 'V-F6'); ;[s, c] = withHand(s, 0, 'V-F2'); return [s, c] },
      () => { let s = withHandSize(makeGame(), 0, 0); let c: number
        ;[s] = withField(s, 0, 'backups', 'V-B1'); ;[s] = withHand(s, 0, 'V-F6'); ;[s, c] = withHand(s, 0, 'V-F4'); return [s, c] },
    ]
    for (const [i, make] of fixtures.entries()) {
      const [s, card] = make()
      const p = preferredPayment(s, 0, card)
      if (!p) continue
      const legal = legalCommands(s, 0).filter((c) => (c.type === 'castCharacter' || c.type === 'castSummon') && c.card === card)
      const match = legal.some((c) => JSON.stringify((c as { payment: unknown }).payment) === JSON.stringify(p))
      expect(match, `fixture ${i}: ${JSON.stringify(p)} not among ${legal.length} legal payments`).toBe(true)
    }
  })
  it('satisfies multi-element requirements and returns null when unaffordable', () => {
    let s = withHandSize(makeGame(), 0, 0); let dual: number, poor: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')          // earth
    ;[s] = withHand(s, 0, 'V-F6')                       // lightning 2000 — cheap discard supplies lightning
    ;[s, dual] = withHand(s, 0, 'V-F4')                 // earth/lightning cost 2
    const p = preferredPayment(s, 0, dual)!
    expect(canPay(2, ['earth', 'lightning'], generateCp(s, 0, p, dual))).toBe(true)
    let t = withHandSize(makeGame(), 0, 0)
    ;[t, poor] = withHand(t, 0, 'V-F8')                 // cost 5, nothing to pay with
    expect(preferredPayment(t, 0, poor)).toBeNull()
  })
  it('F4: satisfies scarce elements first so a dual-element discard is kept for the element only it can pay (Codex counterexample)', () => {
    const defs = [
      ...VANILLA_POOL,
      makeDef({ code: 'V-TARGET', type: 'forward', elements: ['earth', 'lightning'], cost: 3, power: 5000 }),   // the cast target
      makeDef({ code: 'V-DUAL', type: 'forward', elements: ['earth', 'lightning'], cost: 1, power: 1000 }),      // cheap — only source of lightning
      makeDef({ code: 'V-EARTHONLY', type: 'forward', elements: ['earth'], cost: 5, power: 9000 }),              // expensive — but still needed for earth
    ]
    let s = withHandSize(makeGame({ defs }), 0, 0); let target: number
    ;[s] = withHand(s, 0, 'V-EARTHONLY')
    ;[s] = withHand(s, 0, 'V-DUAL')
    ;[s, target] = withHand(s, 0, 'V-TARGET')
    // A greedy cheapest-first-by-element algorithm spends V-DUAL on earth (it's cheaper than V-EARTHONLY) and then
    // has nothing left for lightning. The correct payment spends V-EARTHONLY on earth and V-DUAL on lightning.
    const p = preferredPayment(s, 0, target)!
    expect(p).not.toBeNull()
    expect(canPay(3, ['earth', 'lightning'], generateCp(s, 0, p, target))).toBe(true)
  })
  it('does not count a multi-element backup for its non-first element (engine produces elements[0] only)', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-BD', type: 'backup', elements: ['earth', 'lightning'], cost: 1, power: null })]
    let s = withHandSize(makeGame({ defs }), 0, 0); let card: number
    ;[s] = withField(s, 0, 'backups', 'V-BD')          // produces EARTH only
    ;[s, card] = withHand(s, 0, 'V-F6')                 // lightning cost 1 — cannot be paid
    expect(preferredPayment(s, 0, card)).toBeNull()
  })
  it('C2: bounded backtracking covers 3 required elements when a single scarcity-ordered greedy pass would strand one (Codex counterexample)', () => {
    const defs = [
      ...VANILLA_POOL,
      makeDef({ code: 'V-TARGET3', type: 'forward', elements: ['earth', 'lightning', 'fire'], cost: 3, power: 5000 }),
      makeDef({ code: 'V-EARTH', type: 'forward', elements: ['earth'], cost: 4, power: 8000 }),          // sole earth-only source — EXPENSIVE
      makeDef({ code: 'V-EL', type: 'forward', elements: ['earth', 'lightning'], cost: 1, power: 1000 }), // sole other earth source, one of two lightning sources — CHEAP
      makeDef({ code: 'V-LF', type: 'forward', elements: ['lightning', 'fire'], cost: 2, power: 3000 }),  // sole fire source, other lightning source
    ]
    let s = withHandSize(makeGame({ defs }), 0, 0); let target: number
    ;[s] = withHand(s, 0, 'V-EARTH')
    ;[s] = withHand(s, 0, 'V-EL')
    ;[s] = withHand(s, 0, 'V-LF')
    ;[s, target] = withHand(s, 0, 'V-TARGET3')
    // Scarcity puts fire first (only V-LF), then earth (tie, processed next): a single greedy pass picks the
    // CHEAPEST earth source, V-EL — but V-EL is the ONLY remaining source for lightning once V-LF is spent on
    // fire, so a non-backtracking greedy pass then fails lightning even though {earth: V-EARTH, lightning: V-EL,
    // fire: V-LF} is a legal assignment. Bounded backtracking must find it.
    const p = preferredPayment(s, 0, target)
    expect(p).not.toBeNull()
    expect(canPay(3, ['earth', 'lightning', 'fire'], generateCp(s, 0, p!, target))).toBe(true)
  })
  it('C3: preferredPayment pays a Light card with two off-element (earth) backups, no same-element CP needed', () => {
    const defs = [...VANILLA_POOL, makeDef({ code: 'V-L1', elements: ['light'], cost: 2, power: 5000 })]
    let s = withHandSize(makeGame({ defs }), 0, 0); let card: number
    ;[s] = withField(s, 0, 'backups', 'V-B1')   // earth
    ;[s] = withField(s, 0, 'backups', 'V-B3')   // earth
    ;[s, card] = withHand(s, 0, 'V-L1')
    const p = preferredPayment(s, 0, card)
    expect(p).not.toBeNull()
    expect(p!.discards).toEqual([])
    expect(canPay(2, [], generateCp(s, 0, p!, card))).toBe(true)
  })
})

describe('C6: a Backup that can produce two Elements', () => {
  // Synthetic, like the rest of this file: the machinery is what belongs here, and the real Moogle card is
  // tested against its printed text in packages/cards.
  //
  // `preferredPaymentFor` builds its OWN element assignment, so it can drift from what `canPay` accepts — a
  // previous rung shipped 40% of preferred payments outside `legalCommands`. These assert agreement rather
  // than assume it, which is exactly why the spec called it out as a trap.
  const FIXER = makeDef({
    code: 'T-FIX', type: 'backup', elements: ['earth'], cost: 1, power: null,
    hasAbilities: true, abilityClauses: 1, text: 'T-FIX can produce Lightning CP.',
    abilities: [{
      id: 'T-FIX:lightning-cp',
      trigger: { kind: 'static', effect: { kind: 'produceElement', element: 'lightning' } },
      text: 'T-FIX can produce Lightning CP.',
      effects: [],
    }],
  })
  const PLAIN = makeDef({ code: 'T-PLAIN', type: 'backup', elements: ['earth'], cost: 1, power: null })
  const POOL = [...VANILLA_POOL, FIXER, PLAIN]
  const game = () => makeGame({ defs: POOL })
  const sameIds = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

  it('is spent on the Element only IT can cover, and on a payment legalCommands offers', () => {
    let s = game(); let fixer: number
    ;[s, fixer] = withField(s, 0, 'backups', 'T-FIX')
    const req = { amount: 1, requiredElements: ['lightning'] as const, excluded: [] as number[] }

    const preferred = preferredPaymentFor(s, 0, req)
    expect(preferred, 'the AI could not pay a Lightning cost with the fixer').not.toBeNull()
    expect(preferred?.dullBackups).toEqual([fixer])
    expect(enumeratePaymentsFor(s, 0, req).some((p) => sameIds(p.dullBackups, preferred!.dullBackups))).toBe(true)
  })

  it('backtracks rather than stranding a requirement, and still agrees with legalCommands', () => {
    // Greedy in printed order gives Earth to the fixer and leaves the pure-Earth Backup on Lightning.
    let s = game(); let fixer: number; let plain: number
    ;[s, fixer] = withField(s, 0, 'backups', 'T-FIX')
    ;[s, plain] = withField(s, 0, 'backups', 'T-PLAIN')
    const req = { amount: 2, requiredElements: ['earth', 'lightning'] as const, excluded: [] as number[] }

    const preferred = preferredPaymentFor(s, 0, req)
    expect(preferred).not.toBeNull()
    expect([...(preferred?.dullBackups ?? [])].sort()).toEqual([fixer, plain].sort())
    expect(enumeratePaymentsFor(s, 0, req).some((p) => sameIds(p.dullBackups, preferred!.dullBackups))).toBe(true)
  })

  it('does not let a plain Backup cover the Element it cannot produce', () => {
    // Hand emptied: a Lightning card discarded yields two Lightning CP, so with a hand there is a legal
    // payment and the Backup is not what proves anything.
    let s = withHandSize(game(), 0, 0); let plain: number
    ;[s, plain] = withField(s, 0, 'backups', 'T-PLAIN')
    void plain
    expect(preferredPaymentFor(s, 0, { amount: 1, requiredElements: ['lightning'], excluded: [] })).toBeNull()
  })
})

describe('a source covers as many requirements as it generates CP', () => {
  // Surfaced by the C6 review, as a divergence between two independent implementations of the same matching.
  // The engine's `assignable` sees the CP array, where a discard appears TWICE (`generateCp` pushes two).
  // The AI's `assignRequiredElements` saw the SOURCE, and treated it as one slot — so a doubled Element
  // requirement that one discard covers made the AI find no payment at all and decline to cast a card it
  // could afford. Latent while no card in the pool prints a repeated Element; a real divergence regardless.
  const single = (e: 'earth' | 'lightning') =>
    makeDef({ code: e === 'earth' ? 'T-E1' : 'T-L1', elements: [e], cost: 1, power: 3000 })
  const POOL = [...VANILLA_POOL, single('earth'), single('lightning')]

  it('lets ONE discard cover a doubled requirement, agreeing with the engine', () => {
    let s = withHandSize(makeGame({ defs: POOL }), 0, 0)
    let inHand: number
    ;[s, inHand] = withHand(s, 0, 'T-L1')   // one Lightning card: discarded it yields TWO Lightning CP
    const req = { amount: 2, requiredElements: ['lightning', 'lightning'] as const, excluded: [] as number[] }

    // The engine accepts it...
    const enumerated = enumeratePaymentsFor(s, 0, req)
    expect(enumerated.length, 'the engine found no payment either — fixture is wrong').toBeGreaterThan(0)
    // ...and so must the AI, with the same single discard.
    const preferred = preferredPaymentFor(s, 0, req)
    expect(preferred, 'the AI declined a payment the engine accepts').not.toBeNull()
    expect(preferred?.discards.map((d) => d.card)).toEqual([inHand])
    expect(canPay(req.amount, req.requiredElements, generateCp(s, 0, preferred!, []))).toBe(true)
  })

  it('does not let one discard cover TWO DIFFERENT Elements', () => {
    // A discard declares one Element on the Payment and yields two CP of it, so a two-Element card cannot
    // pay an Earth requirement and a Lightning one by being discarded once.
    const dual = makeDef({ code: 'T-EL', elements: ['earth', 'lightning'], cost: 1, power: 3000 })
    let s = withHandSize(makeGame({ defs: [...VANILLA_POOL, dual] }), 0, 0)
    ;[s] = withHand(s, 0, 'T-EL')
    const req = { amount: 2, requiredElements: ['earth', 'lightning'] as const, excluded: [] as number[] }

    expect(enumeratePaymentsFor(s, 0, req)).toEqual([])   // the engine refuses it
    expect(preferredPaymentFor(s, 0, req)).toBeNull()     // and so does the AI
  })
})
