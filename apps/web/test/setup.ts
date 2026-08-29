/**
 * React needs to be told it is in a test environment, or `act()` does not do its job.
 *
 * Without this every mounted-component test in this package emitted "The current testing environment is not
 * configured to support act(...)" — `focus.test.tsx` alone produced it 49 times — and React does not
 * guarantee that effects flush synchronously inside `act()`. Since almost everything proved about the board
 * this session rests on mounting it, driving a transition and asserting the result, those tests were weaker
 * than they looked: an effect that had not run yet would read as an effect that did nothing.
 *
 * Pre-existing rather than introduced by any one rung, and found by not ignoring a warning.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
export {}
