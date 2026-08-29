/**
 * Declares this as a React act environment.
 *
 * Every mounted-component test in this package was emitting "The current testing environment is not
 * configured to support act(...)" — `focus.test.tsx` alone 49 times — because `IS_REACT_ACT_ENVIRONMENT` was
 * never set.
 *
 * WHAT THIS ACTUALLY FIXES, measured rather than assumed. I first claimed that without it React did not
 * guarantee effects flush inside `act()`, so the suite was unreliable. That was too strong. A probe — a
 * component whose effect sets state, rendered inside `act()` — reads the post-effect value BOTH with the
 * flag and without it. For the synchronous mount-and-assert shape every test here uses, flushing happens
 * either way.
 *
 * So this removes a legitimate warning and declares the environment React asks callers to declare; it did
 * not repair a broken suite. Worth having, and worth not overselling: 312 tests passed before and after,
 * and they were passing for the right reasons already.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
export {}
